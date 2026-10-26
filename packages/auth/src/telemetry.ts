export type ClientTelemetry = {
  ipAddress: string;
  userAgent: string;
  browser?: string;
  os?: string;
  deviceType?: string;
  language?: string;
  timezone?: string;
  country?: string;
  city?: string;
};

export function extractTelemetryFromHeaders(headers: Headers): ClientTelemetry {
  // Extract real client IP across proxy configurations
  const ipAddress =
    headers.get("cf-connecting-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "127.0.0.1";

  const userAgent = headers.get("user-agent") || "Unknown";
  const language = headers.get("accept-language")?.split(",")[0] || undefined;
  const timezone = headers.get("x-client-timezone") || undefined;

  // Cloudflare Header Geo-location
  const country = headers.get("cf-ipcountry") || undefined;
  const city = headers.get("cf-ipcity") || undefined;

  // Simple UA Parser for OS, Browser, and Device Type
  const { browser, os, deviceType } = parseUserAgent(userAgent);

  return {
    ipAddress,
    userAgent,
    browser,
    os,
    deviceType,
    language,
    timezone,
    country,
    city,
  };
}

function parseUserAgent(ua: string) {
  let browser = "Other";
  let os = "Other";
  let deviceType = "desktop";

  // Device detection
  if (/mobile/i.test(ua)) deviceType = "mobile";
  else if (/ipad|tablet/i.test(ua)) deviceType = "tablet";

  // OS detection. iOS is checked before macOS because iOS user agents also
  // contain "like Mac OS X", which would otherwise be misclassified.
  if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/macintosh|mac os x/i.test(ua)) os = "macOS";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";

  // Browser detection
  if (/edg/i.test(ua)) browser = "Edge";
  else if (/chrome/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = "Safari";
  else if (/firefox/i.test(ua)) browser = "Firefox";

  return { browser, os, deviceType };
}
