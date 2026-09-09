// monitoring/cdn-entry.js
// Bundled standalone via `npm run build:monitoring` and hosted on a CDN.
// Consuming pages include it as:
// <script src="https://logger.example.com/monitoring/v1/monitoring.min.js" data-app="nui"></script>

import { MonitoringService, normalizeEndpoint } from "./MonitoringService"
import { clearSessionId, setSessionId } from "./Identity"

const PUBLIC_API_NAME = "kapture-monitoring"
const PUBLIC_API_VERSION = 1
const EMPTY_CONFIG = Object.freeze({})

function getOwnDataProperty(object, propertyName) {
    const descriptor = Object.getOwnPropertyDescriptor(object, propertyName)

    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value") ? descriptor.value : undefined
}

function normalizeString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readClientConfig() {
    try {
        const windowConfigDescriptor = Object.getOwnPropertyDescriptor(window, "KaptureMonitoringConfig")

        if (!windowConfigDescriptor || !Object.prototype.hasOwnProperty.call(windowConfigDescriptor, "value")) {
            return EMPTY_CONFIG
        }

        const candidate = windowConfigDescriptor.value

        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
            return EMPTY_CONFIG
        }

        const prototype = Object.getPrototypeOf(candidate)

        if (prototype !== Object.prototype && prototype !== null) {
            return EMPTY_CONFIG
        }

        const endpoint = normalizeEndpoint(getOwnDataProperty(candidate, "endpoint"))
        const app = normalizeString(getOwnDataProperty(candidate, "app"))
        const getClientDetails = getOwnDataProperty(candidate, "getClientDetails")

        return Object.freeze({
            endpoint,
            app,
            getClientDetails: typeof getClientDetails === "function" ? getClientDetails : undefined,
        })
    } catch (_error) {
        return EMPTY_CONFIG
    }
}

function getDefaultEndpoint(script) {
    const scriptUrl = normalizeEndpoint(script?.src)

    return scriptUrl ? new URL("/api/logs", scriptUrl).href : undefined
}

function exposeSessionIdentityApi() {
    const existingApi = getOwnDataProperty(window, "MonitoringService")
    const isObjectLike = existingApi !== null && (
        typeof existingApi === "object" || typeof existingApi === "function"
    )
    const publicApi = isObjectLike ? existingApi : {}

    try {
        const identityMethods = { setSessionId, clearSessionId }

        Object.entries(identityMethods).forEach(([methodName, method]) => {
            if (typeof getOwnDataProperty(publicApi, methodName) === "function") {
                return
            }

            Object.defineProperty(publicApi, methodName, {
                value: method,
                enumerable: true,
                writable: true,
                configurable: true,
            })
        })

        if (!isObjectLike) {
            Object.freeze(publicApi)

            Object.defineProperty(window, "MonitoringService", {
                value: publicApi,
                writable: false,
                configurable: false,
            })
        }
    } catch (_error) {
        // Keep monitoring active if an incompatible global already uses this name.
    }
}

// function to expose certain monitoring details
function exposePublicApi(status) {
    const existingApi = getOwnDataProperty(window, "KaptureMonitoring")

    if (
        existingApi
        && getOwnDataProperty(existingApi, "name") === PUBLIC_API_NAME
        && getOwnDataProperty(existingApi, "version") === PUBLIC_API_VERSION
        && typeof getOwnDataProperty(existingApi, "setClientDetailsProvider") === "function"
    ) {
        return
    }

    const publicApi = Object.freeze({
        name: PUBLIC_API_NAME,
        version: PUBLIC_API_VERSION,
        getStatus: () => status,
        setClientDetailsProvider: provider => MonitoringService.setClientDetailsProvider(provider),
    })

    try {
        Object.defineProperty(window, "KaptureMonitoring", {
            value: publicApi,
            writable: false,
            configurable: false,
        })
    } catch (_error) {
        // Keep monitoring active even when another non-configurable global uses this name.
    }
}

const script = document.currentScript
const clientConfig = readClientConfig()

exposeSessionIdentityApi()

const status = Object.freeze(MonitoringService.start({
    endpoint: normalizeEndpoint(script?.dataset.endpoint) || clientConfig.endpoint || getDefaultEndpoint(script),
    app: normalizeString(script?.dataset.app) || clientConfig.app,
    getClientDetails: clientConfig.getClientDetails,
}))

exposePublicApi(status)
