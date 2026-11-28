import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { limit, peekLimit, resetMemoryLimits } from "@/lib/ratelimit";

describe("lib/ratelimit peekLimit", () => {
  beforeEach(() => {
    resetMemoryLimits();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  });

  afterEach(() => {
    resetMemoryLimits();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not consume tokens in in-memory mode", async () => {
    const key = "peek-nonconsume-user";
    for (let i = 0; i < 20; i++) {
      const p = await peekLimit("giftCardRedeemUser", key);
      expect(p.blocked).toBe(false);
    }
    const res = await limit("giftCardRedeemUser", key);
    expect(res.ok).toBe(true);
  });

  it("reports blocked: true once limit is reached without changing limit() behavior", async () => {
    const key = "peek-block-user";
    for (let i = 0; i < 10; i++) {
      const res = await limit("giftCardRedeemUser", key);
      expect(res.ok).toBe(true);
      if (i < 9) {
        expect((await peekLimit("giftCardRedeemUser", key)).blocked).toBe(false);
      }
    }

    expect((await peekLimit("giftCardRedeemUser", key)).blocked).toBe(true);
    const blockedRes = await limit("giftCardRedeemUser", key);
    expect(blockedRes.ok).toBe(false);
  });

  it("respects policy failMode in production when Redis is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const closedPeek = await peekLimit("giftCardRedeemUser", "u1");
    expect(closedPeek.blocked).toBe(true);

    const openPeek = await peekLimit("createOrder", "u1");
    expect(openPeek.blocked).toBe(false);
  });
});
