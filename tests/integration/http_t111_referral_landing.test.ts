import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupM1TestRows, createTestUser } from "../helpers/fixtures";
import { getOrCreateReferralCode } from "@/lib/rewards/service";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T111: Referral Landing, /account/referrals Guard & Rewards Cron (HTTP)", () => {
  beforeAll(async () => {
    await cleanupM1TestRows();
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  it("/r/VALIDCODE and /r/NOPE99 return identical 307 redirect to / and set habitt_ref cookie", async () => {
    const user = await createTestUser();
    const ref = await getOrCreateReferralCode(user.id);

    const [validRes, invalidRes] = await Promise.all([
      fetch(`${BASE_URL}/r/${ref.code}`, { redirect: "manual" }),
      fetch(`${BASE_URL}/r/NOPE99`, { redirect: "manual" }),
    ]);

    expect(validRes.status).toBe(307);
    expect(invalidRes.status).toBe(307);
    expect(validRes.headers.get("location")).toBe(invalidRes.headers.get("location"));
    expect(validRes.headers.get("set-cookie")).toContain("habitt_ref=");
    expect(invalidRes.headers.get("set-cookie")).toContain("habitt_ref=");
  });

  it("/account/referrals redirects anonymous users to login", async () => {
    const res = await fetch(`${BASE_URL}/account/referrals`, { redirect: "manual" });
    expect([302, 307]).toContain(res.status);
  });

  it("/api/cron/rewards enforces CRON_SECRET and is idempotent on second call", async () => {
    const unauth = await fetch(`${BASE_URL}/api/cron/rewards`);
    expect(unauth.status).toBe(401);

    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return;

    const r1 = await fetch(`${BASE_URL}/api/cron/rewards`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    expect(r1.status).toBe(200);
    const d1 = await r1.json();
    expect(d1.success).toBe(true);

    const r2 = await fetch(`${BASE_URL}/api/cron/rewards`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    expect(r2.status).toBe(200);
    const d2 = await r2.json();
    expect(d2.success).toBe(true);
    expect(d2.itemsProcessed).toBe(0);
  });
});
