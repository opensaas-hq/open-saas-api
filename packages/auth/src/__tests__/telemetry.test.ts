import { describe, expect, test } from "bun:test";
import { extractTelemetryFromHeaders } from "../telemetry";

describe("@opensaas/auth - Telemetry & Fingerprinting", () => {
  test("should extract real IP from Cloudflare header", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.195",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "accept-language": "es-MX,es;q=0.9",
      "cf-ipcountry": "MX",
      "cf-ipcity": "Mexico City",
    });

    const telemetry = extractTelemetryFromHeaders(headers);

    expect(telemetry.ipAddress).toBe("203.0.113.195");
    expect(telemetry.browser).toBe("Chrome");
    expect(telemetry.os).toBe("macOS");
    expect(telemetry.country).toBe("MX");
    expect(telemetry.city).toBe("Mexico City");
  });

  test("should fallback to 127.0.0.1 when no IP headers are present", () => {
    const headers = new Headers({});
    const telemetry = extractTelemetryFromHeaders(headers);

    expect(telemetry.ipAddress).toBe("127.0.0.1");
    expect(telemetry.browser).toBe("Other");
    expect(telemetry.os).toBe("Other");
  });
});
