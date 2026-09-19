import { addEvent } from "./EventQueue"
import { CLIENT_MONITORING_CONFIG } from "./ClientMonitoringConfig"

const MAX_CAPTURED_RESPONSE_LENGTH = 100000
const SENSITIVE_HEADERS = new Set([
    "authorization",
    "cookie",
    "proxy-authorization",
    "set-cookie",
    "x-api-key",
])
const CAPTURED_RESPONSE_CONTENT_TYPES = [
    "application/javascript",
    "application/json",
    "application/problem+json",
    "application/x-www-form-urlencoded",
    "application/xml",
    "text/",
]
const ignoredFetchUrls = new Set()

function getTimestamp() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()
}

function getDuration(startTime) {
    return Math.max(0, Math.round((getTimestamp() - startTime) * 100) / 100)
}

function getAbsoluteUrl(input) {
    try {
        const url = typeof input === "string" || input instanceof URL
            ? input.toString()
            : input?.url

        return new URL(url, window.location.href).toString()
    } catch (error) {
        return "[Unable to capture request URL]"
    }
}

function normalizeHeaders(headers) {
    if (!headers) {
        return undefined
    }

    try {
        const normalizedHeaders = {}

        new Headers(headers).forEach((value, key) => {
            normalizedHeaders[key] = SENSITIVE_HEADERS.has(key.toLowerCase())
                ? "[REDACTED]"
                : value
        })

        return normalizedHeaders
    } catch (error) {
        return "[Unable to capture headers]"
    }
}

function getRequestHeaders(input, init) {
    try {
        if (init?.headers) {
            return normalizeHeaders(init.headers)
        }

        return normalizeHeaders(input instanceof Request ? input.headers : undefined)
    } catch (error) {
        return normalizeHeaders(init?.headers)
    }
}

function describeRequestBody(body) {
    if (body === undefined || body === null) {
        return undefined
    }

    if (typeof body === "string") {
        return body
    }

    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
        return body.toString()
    }

    if (typeof FormData !== "undefined" && body instanceof FormData) {
        return Array.from(body.entries()).map(([key, value]) => [
            key,
            typeof value === "string"
                ? value
                : { name: value.name, size: value.size, type: value.type },
        ])
    }

    if (typeof Blob !== "undefined" && body instanceof Blob) {
        return { type: body.type || "Blob", size: body.size }
    }

    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
        return `[ArrayBuffer: ${body.byteLength} bytes]`
    }

    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(body)) {
        return `[${body.constructor?.name || "TypedArray"}: ${body.byteLength} bytes]`
    }

    return Object.prototype.toString.call(body)
}

function getRequestDetails(input, init) {
    const isRequest = typeof Request !== "undefined" && input instanceof Request
    const body = Object.prototype.hasOwnProperty.call(init || {}, "body")
        ? init.body
        : isRequest && input.body
            ? "[Request body stream]"
            : undefined

    return {
        url: getAbsoluteUrl(input),
        method: (init?.method || (isRequest ? input.method : "GET") || "GET").toUpperCase(),
        requestHeaders: getRequestHeaders(input, init),
        requestData: describeRequestBody(body),
        withCredentials: (init?.credentials || (isRequest ? input.credentials : undefined)) === "include",
    }
}

function getSafeRequestDetails(input, init) {
    try {
        return getRequestDetails(input, init)
    } catch (error) {
        return {
            url: getAbsoluteUrl(input),
            method: "UNKNOWN",
            requestData: "[Unable to capture request details]",
        }
    }
}

function shouldIgnoreFetchRequest(url, getCurrentCmId) {
    const defaultConfig = CLIENT_MONITORING_CONFIG.default
    const clientConfig = CLIENT_MONITORING_CONFIG[getCurrentCmId?.()] || {}
    const configuredIgnoredUrls = [
        ...ignoredFetchUrls,
        ...defaultConfig.ignoredUrls,
        ...(clientConfig.ignoredUrls || []),
    ]

    return configuredIgnoredUrls.some(ignoredUrl => {
        try {
            const requestUrl = new URL(url, window.location.href)
            const normalizedIgnoredUrl = new URL(ignoredUrl, window.location.href)
            const ignoresEntireOrigin = normalizedIgnoredUrl.pathname === "/"
                && !normalizedIgnoredUrl.search
                && !normalizedIgnoredUrl.hash

            return ignoresEntireOrigin
                ? requestUrl.origin === normalizedIgnoredUrl.origin
                : requestUrl.toString() === normalizedIgnoredUrl.toString()
                    || requestUrl.pathname.startsWith(`${normalizedIgnoredUrl.pathname.replace(/\/$/, "")}/`)
        } catch (error) {
            return ignoredUrl === url
        }
    })
}

function canCaptureResponseBody(response) {
    const contentType = response.headers.get("content-type")?.toLowerCase() || ""
    const contentLength = Number(response.headers.get("content-length"))

    if (Number.isFinite(contentLength) && contentLength > MAX_CAPTURED_RESPONSE_LENGTH) {
        return false
    }

    return CAPTURED_RESPONSE_CONTENT_TYPES.some(type => contentType.includes(type))
}

function getSkippedResponseBodyMessage(response) {
    const contentType = response.headers.get("content-type")?.toLowerCase()
    const contentLength = Number(response.headers.get("content-length"))

    if (Number.isFinite(contentLength) && contentLength > MAX_CAPTURED_RESPONSE_LENGTH) {
        return `[Response body not captured: ${contentLength} bytes exceeds the ${MAX_CAPTURED_RESPONSE_LENGTH}-byte limit]`
    }

    if (!contentType) {
        return "[Response body not captured: Content-Type header was not provided]"
    }

    return `[Response body not captured: unsupported or binary content type "${contentType}"]`
}

async function getResponseData(response) {
    if (!canCaptureResponseBody(response)) {
        return getSkippedResponseBodyMessage(response)
    }

    try {
        const responseText = await response.clone().text()
        const capturedText = responseText.length > MAX_CAPTURED_RESPONSE_LENGTH
            ? `${responseText.slice(0, MAX_CAPTURED_RESPONSE_LENGTH)}...[truncated]`
            : responseText
        const contentType = response.headers.get("content-type")?.toLowerCase() || ""

        if (contentType.includes("json")) {
            try {
                return JSON.parse(capturedText)
            } catch (error) {
                return capturedText
            }
        }

        return capturedText
    } catch (error) {
        return "[Unable to capture response body]"
    }
}

function captureExternalAxiosInfo(status, source, additionalParams = {}) {
    const config = source?.config || {}
    const response = status === "success" ? source : source?.response

    addEvent({
        id: crypto.randomUUID(),
        type: "api-request",
        timestamp: new Date().toISOString(),
        status,

        url: config.url,
        baseURL: config.baseURL,
        method: config.method?.toUpperCase(),
        params: config.params,
        requestData: config.data,
        requestHeaders: config.headers,
        withCredentials: config.withCredentials,
        timeout: config.timeout,
        duration: config.timeDuration,

        statusCode: response?.status,
        statusText: response?.statusText,
        responseHeaders: response?.headers,
        responseData: response?.data,

        errorMessage: status === "error" ? source?.message : undefined,
        errorCode: status === "error" ? source?.code : undefined,
        errorName: status === "error" ? source?.name : undefined,
        isTimeout: status === "error" ? source?.code === "ECONNABORTED" || source?.code === "ETIMEDOUT" : undefined,
        ...additionalParams,
    })
}

function captureNativeFetchInfo(status, requestDetails, duration, response, error, responseData) {
    addEvent({
        id: crypto.randomUUID(),
        type: "api-request",
        timestamp: new Date().toISOString(),
        status,
        ...requestDetails,
        duration,
        statusCode: response?.status,
        statusText: response?.statusText,
        responseHeaders: normalizeHeaders(response?.headers),
        responseData,
        errorMessage: error?.message,
        errorName: error?.name,
    })
}

function safelyCaptureNativeFetchInfo(...args) {
    try {
        captureNativeFetchInfo(...args)
    } catch (error) {
        // Monitoring must never change the behavior of the intercepted request.
    }
}

function trackNativeFetch(getCurrentCmId) {
    if (typeof window.fetch !== "function") {
        return
    }

    const originalFetch = window.fetch.bind(window)

    window.fetch = async (input, init) => {
        const requestDetails = getSafeRequestDetails(input, init)

        if (shouldIgnoreFetchRequest(requestDetails.url, getCurrentCmId)) {
            return originalFetch(input, init)
        }

        const startTime = getTimestamp()

        try {
            const response = await originalFetch(input, init)
            const duration = getDuration(startTime)

            getResponseData(response)
                .then(responseData => safelyCaptureNativeFetchInfo(
                    response.ok ? "success" : "error",
                    requestDetails,
                    duration,
                    response,
                    undefined,
                    responseData
                ))
                .catch(() => safelyCaptureNativeFetchInfo(
                    response.ok ? "success" : "error",
                    requestDetails,
                    duration,
                    response
                ))

            return response
        } catch (error) {
            safelyCaptureNativeFetchInfo("error", requestDetails, getDuration(startTime), undefined, error)
            throw error
        }
    }
}

if (typeof window !== "undefined" && typeof window.__captureNetworkEvent !== "function") {
    window.__captureNetworkEvent = () => {}
}

export function startFetchTracker(config = {}) {
    const ignoredUrls = config.ignoredUrls || []

    ignoredUrls.filter(Boolean).forEach(url => ignoredFetchUrls.add(url))

    if (window.__networkTrackerInitialized) {
        return
    }

    Object.defineProperty(window, "__captureNetworkEvent", {
        value: captureExternalAxiosInfo,
        writable: false,
        configurable: false,
    })

    trackNativeFetch(config.getCurrentCmId)
    window.__networkTrackerInitialized = true
}
