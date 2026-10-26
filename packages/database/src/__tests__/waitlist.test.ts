import { describe, expect, test } from "bun:test";
import {
  createWaitlistEntry,
  getWaitlistEntryByEmail,
} from "../repositories/waitlist";
import { useTestDatabase } from "./setup";

useTestDatabase();

describe("@opensaas/database - Waitlist repository", () => {
  const suffix = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  test("records a waitlisted registration keyed by email", async () => {
    const email = `wait_${suffix()}@example.com`;
    const entry = await createWaitlistEntry({ email });

    expect(entry?.email).toBe(email);
    expect(entry?.status).toBe("pending");
    expect(entry?.userId).toBeNull();
  });

  test("fetches a waitlist row by email", async () => {
    const email = `wait_${suffix()}@example.com`;
    await createWaitlistEntry({ email });

    const found = await getWaitlistEntryByEmail({ email });
    expect(found?.email).toBe(email);

    const missing = await getWaitlistEntryByEmail({
      email: `none_${suffix()}@example.com`,
    });
    expect(missing).toBeUndefined();
  });
});
