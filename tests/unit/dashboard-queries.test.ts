import { describe, it, expect } from "vitest";
import { checkCronStaleness, KNOWN_CRON_SCHEDULES } from "@/lib/admin/dashboard";

describe("Dashboard Cron Staleness Unit Tests", () => {
  const baseTime = new Date("2026-11-23T10:00:00.000Z");

  it("marks a job stale if it has never executed", () => {
    const res = checkCronStaleness("outbox", null, baseTime);
    expect(res.isStale).toBe(true);
    expect(res.isFailed).toBe(false);
    expect(res.reason).toBe("Never executed");
  });

  it("marks a job failed if last status was FAILED regardless of timing", () => {
    const recentFail = {
      ok: false,
      startedAt: new Date(baseTime.getTime() - 2 * 60 * 1000), // 2 min ago
    };
    const res = checkCronStaleness("outbox", recentFail, baseTime);
    expect(res.isFailed).toBe(true);
    expect(res.reason).toBe("Last run failed");
  });

  it("marks a job healthy when run recently within 2x interval", () => {
    const interval = KNOWN_CRON_SCHEDULES["outbox"]; // 10 min
    const recentSuccess = {
      ok: true,
      startedAt: new Date(baseTime.getTime() - interval), // 10 min ago (<= 20m)
    };
    const res = checkCronStaleness("outbox", recentSuccess, baseTime);
    expect(res.isStale).toBe(false);
    expect(res.isFailed).toBe(false);
  });

  it("marks a job stale when elapsed exceeds 2x expected interval", () => {
    const interval = KNOWN_CRON_SCHEDULES["outbox"]; // 10 min
    const oldSuccess = {
      ok: true,
      startedAt: new Date(baseTime.getTime() - (2 * interval + 1000)), // 20m 1s ago
    };
    const res = checkCronStaleness("outbox", oldSuccess, baseTime);
    expect(res.isStale).toBe(true);
    expect(res.isFailed).toBe(false);
    expect(res.reason).toContain("> 2x interval");
  });
});
