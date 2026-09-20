import nodemailer from "nodemailer";

export async function sendDetectionEmail(
  detection,
  environment = process.env,
  createTransport = nodemailer.createTransport,
) {
  const user = environment.GMAIL_USER?.trim();
  const password = environment.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  const recipients = environment.ALERT_EMAIL_RECIPIENTS
    ?.split(",")
    .map((recipient) => recipient.trim())
    .filter(Boolean);

  if (!user || !password || !recipients?.length) return false;

  const transport = createTransport({
    service: "gmail",
    auth: { user, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const severity = detection.severity.toUpperCase();
  const severityColor = detection.severity === "critical" ? "#dc2626" : "#ea580c";

  await transport.sendMail({
    from: user,
    to: recipients,
    subject: `[Kapture Trace][${severity}] ${detection.title} — ${detection.app}`,
    text: [
      `Kapture Trace ${severity} alert`,
      "",
      detection.title,
      detection.summary,
      "",
      `Application: ${detection.app}`,
      `Customer name: ${detection.customerName || "Not available"}`,
      `Customer ID: ${detection.cmId}`,
      `Affected sessions: ${detection.affectedSessions}`,
      `First detected: ${detection.firstSeenAt}`,
      `Last detected: ${detection.lastSeenAt}`,
    ].join("\n"),
    html: `
      <div style="margin:0;padding:32px 16px;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
        <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.08)">
          <div style="padding:24px 28px;background:#0f172a;color:#ffffff">
            <div style="font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#93c5fd">Kapture Trace</div>
            <div style="margin-top:10px;font-size:24px;font-weight:700;line-height:1.3">Automatic detection alert</div>
          </div>
          <div style="padding:28px">
            <span style="display:inline-block;padding:6px 10px;border-radius:999px;background:${severityColor};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.8px">${severity}</span>
            <h1 style="margin:16px 0 8px;font-size:22px;line-height:1.35;color:#0f172a">${escapeHtml(detection.title)}</h1>
            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6">${escapeHtml(detection.summary)}</p>
            <table role="presentation" style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px;font-size:14px">
              <tr><td style="padding:14px 16px;color:#64748b;border-bottom:1px solid #e2e8f0">Application</td><td style="padding:14px 16px;text-align:right;font-weight:700;border-bottom:1px solid #e2e8f0">${escapeHtml(detection.app)}</td></tr>
              <tr><td style="padding:14px 16px;color:#64748b;border-bottom:1px solid #e2e8f0">Customer name</td><td style="padding:14px 16px;text-align:right;font-weight:700;border-bottom:1px solid #e2e8f0">${escapeHtml(detection.customerName || "Not available")}</td></tr>
              <tr><td style="padding:14px 16px;color:#64748b;border-bottom:1px solid #e2e8f0">Customer ID</td><td style="padding:14px 16px;text-align:right;font-weight:700;border-bottom:1px solid #e2e8f0">${escapeHtml(detection.cmId)}</td></tr>
              <tr><td style="padding:14px 16px;color:#64748b;border-bottom:1px solid #e2e8f0">Affected sessions</td><td style="padding:14px 16px;text-align:right;font-weight:700;border-bottom:1px solid #e2e8f0">${escapeHtml(detection.affectedSessions)}</td></tr>
              <tr><td style="padding:14px 16px;color:#64748b;border-bottom:1px solid #e2e8f0">First detected</td><td style="padding:14px 16px;text-align:right;font-weight:700;border-bottom:1px solid #e2e8f0">${escapeHtml(detection.firstSeenAt)}</td></tr>
              <tr><td style="padding:14px 16px;color:#64748b">Last detected</td><td style="padding:14px 16px;text-align:right;font-weight:700">${escapeHtml(detection.lastSeenAt)}</td></tr>
            </table>
            <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">Generated automatically by Kapture Trace monitoring. Review the detection evidence in your logger dashboard.</p>
          </div>
        </div>
      </div>`,
  });

  return true;
}
