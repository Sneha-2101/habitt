import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let shouldThrow = false;

vi.mock("@upstash/ratelimit", () => {
  return {
    Ratelimit: class MockRatelimit {
      static slidingWindow() {
        return () => {};
      }
      limit = vi.fn().mockImplementation(async () => {
        if (shouldThrow) {
          throw new Error("Upstash Redis connection timeout");
        }
        return { success: true, reset: Date.now() + 60000 };
      });
    },
  };
});

vi.mock("@upstash/redis", () => {
  return {
    Redis: class MockRedis {
      incr = vi.fn().mockImplementation(async () => {
        if (shouldThrow) {
          throw new Error("Upstash Redis incr failure");
        }
        return 1;
      });
      expire = vi.fn().mockResolvedValue(1);
    },
  };
});

import {
  limit,
  otpDailyCap,
  RateLimitUnavailableError,
  resetMemoryLimits,
} from "@/lib/ratelimit";

describe("Rate Limit Fail-Mode (Open vs Closed)", () => {
  beforeEach(() => {
    resetMemoryLimits();
    shouldThrow = false;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("When Upstash Redis variables are unset in production", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
      vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    });

    it("createOrder policy fails open via in-memory fallback without throwing", async () => {
      const res = await limit("createOrder", "prod-user-open");
      expect(res.ok).toBe(true);
      expect(res.retryAfterSec).toBe(0);
    });

    it("checkoutQuote policy fails open via in-memory fallback without throwing", async () => {
      const res = await limit("checkoutQuote", "prod-user-quote-open");
      expect(res.ok).toBe(true);
      expect(res.retryAfterSec).toBe(0);
    });

    it("otpSendIp throws RateLimitUnavailableError (closed failMode)", async () => {
      await expect(limit("otpSendIp", "192.168.1.1")).rejects.toThrow(RateLimitUnavailableError);
    });

    it("otpDailyCap throws RateLimitUnavailableError (closed failMode)", async () => {
      await expect(otpDailyCap()).rejects.toThrow(RateLimitUnavailableError);
    });
  });

  describe("When Redis client throws at runtime", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://mock-redis.upstash.io");
      vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "mock-token-xyz");
      shouldThrow = true;
    });

    it("createOrder policy fails open via in-memory fallback on runtime throw", async () => {
      const res = await limit("createOrder", "prod-user-runtime-open");
      expect(res.ok).toBe(true);
      expect(res.retryAfterSec).toBe(0);
    });

    it("checkoutQuote policy fails open via in-memory fallback on runtime throw", async () => {
      const res = await limit("checkoutQuote", "prod-user-runtime-quote");
      expect(res.ok).toBe(true);
      expect(res.retryAfterSec).toBe(0);
    });

    it("otpSendIp throws RateLimitUnavailableError on runtime throw", async () => {
      await expect(limit("otpSendIp", "10.0.0.1")).rejects.toThrow(RateLimitUnavailableError);
    });

    it("otpDailyCap throws RateLimitUnavailableError on runtime throw", async () => {
      await expect(otpDailyCap()).rejects.toThrow(RateLimitUnavailableError);
    });
  });
});
