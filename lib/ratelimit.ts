import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export class RateLimitUnavailableError extends Error {
  constructor(message = "Rate limiting service is temporarily unavailable") {
    super(message);
    this.name = "RateLimitUnavailableError";
  }
}

export type RateLimitPolicy =
  | "otpSendIdentifier"
  | "otpSendIp"
  | "otpVerifyIdentifier"
  | "otpVerifyIp"
  | "linkIdentifier"
  | "createOrder"
  | "couponCheck"
  | "newsletterIp"
  | "newsletterEmail"
  | "stockNotifyIp"
  | "signUpIp"
  | "checkoutQuote"
  | "staffOtpSendIp"
  | "staffOtpSendIdentifier"
  | "stepUpSend";

export interface PolicyConfig {
  limit: number;
  windowMs: number;
  upstashDuration: "1 m" | "15 m" | "1 h" | "1 d";
  failMode: "open" | "closed";
}

export const POLICY_CONFIGS: Record<RateLimitPolicy, PolicyConfig> = {
  otpSendIdentifier: { limit: 3, windowMs: 15 * 60 * 1000, upstashDuration: "15 m", failMode: "closed" },
  otpSendIp: { limit: 10, windowMs: 60 * 60 * 1000, upstashDuration: "1 h", failMode: "closed" },
  otpVerifyIdentifier: { limit: 10, windowMs: 15 * 60 * 1000, upstashDuration: "15 m", failMode: "closed" },
  otpVerifyIp: { limit: 30, windowMs: 15 * 60 * 1000, upstashDuration: "15 m", failMode: "closed" },
  linkIdentifier: { limit: 5, windowMs: 60 * 60 * 1000, upstashDuration: "1 h", failMode: "closed" },
  createOrder: { limit: 10, windowMs: 60 * 1000, upstashDuration: "1 m", failMode: "open" },
  couponCheck: { limit: 10, windowMs: 60 * 1000, upstashDuration: "1 m", failMode: "closed" },
  newsletterIp: { limit: 3, windowMs: 60 * 60 * 1000, upstashDuration: "1 h", failMode: "closed" },
  newsletterEmail: { limit: 1, windowMs: 24 * 60 * 60 * 1000, upstashDuration: "1 d", failMode: "closed" },
  stockNotifyIp: { limit: 10, windowMs: 60 * 60 * 1000, upstashDuration: "1 h", failMode: "closed" },
  signUpIp: { limit: 5, windowMs: 60 * 60 * 1000, upstashDuration: "1 h", failMode: "closed" },
  checkoutQuote: { limit: 30, windowMs: 60 * 1000, upstashDuration: "1 m", failMode: "open" },
  staffOtpSendIp: { limit: 10, windowMs: 60 * 60 * 1000, upstashDuration: "1 h", failMode: "closed" },
  staffOtpSendIdentifier: { limit: 3, windowMs: 15 * 60 * 1000, upstashDuration: "15 m", failMode: "closed" },
  stepUpSend: { limit: 5, windowMs: 15 * 60 * 1000, upstashDuration: "15 m", failMode: "closed" },
};

// In-memory sliding window state for development and fail-open fallback
const memoryStore = new Map<string, number[]>();
const dailyMemoryStore = new Map<string, number>();
let hasLoggedDevWarning = false;

export function resetMemoryLimits(): void {
  memoryStore.clear();
  dailyMemoryStore.clear();
}

function getRedisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const upstashLimiters = new Map<RateLimitPolicy, Ratelimit>();

function getUpstashLimiter(policy: RateLimitPolicy, redis: Redis): Ratelimit {
  let limiter = upstashLimiters.get(policy);
  if (!limiter) {
    const config = POLICY_CONFIGS[policy];
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(config.limit, config.upstashDuration),
      prefix: `rl_${policy}`,
    });
    upstashLimiters.set(policy, limiter);
  }
  return limiter;
}

function checkMemoryLimit(
  policy: RateLimitPolicy,
  key: string,
  config: PolicyConfig
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const fullKey = `${policy}:${key}`;
  const timestamps = (memoryStore.get(fullKey) || []).filter(
    (ts) => now - ts < config.windowMs
  );

  if (timestamps.length >= config.limit) {
    const oldest = timestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000));
    return { ok: false, retryAfterSec };
  }

  timestamps.push(now);
  memoryStore.set(fullKey, timestamps);
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Checks and increments rate limit for a policy and key.
 * Returns { ok, retryAfterSec }
 */
export async function limit(
  policy: RateLimitPolicy,
  key: string
): Promise<{ ok: boolean; retryAfterSec: number }> {
  const config = POLICY_CONFIGS[policy];
  if (!config) {
    throw new Error(`Unknown rate limit policy: ${policy}`);
  }

  const redis = getRedisClient();

  if (!redis) {
    if (process.env.NODE_ENV === "production" && config.failMode === "closed") {
      throw new RateLimitUnavailableError();
    }

    if (!hasLoggedDevWarning) {
      console.warn(
        "[RateLimit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing. Using in-memory sliding window."
      );
      hasLoggedDevWarning = true;
    }

    return checkMemoryLimit(policy, key, config);
  }

  try {
    const limiter = getUpstashLimiter(policy, redis);
    const result = await limiter.limit(key);

    if (!result.success) {
      const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
      return { ok: false, retryAfterSec };
    }

    return { ok: true, retryAfterSec: 0 };
  } catch (err) {
    console.error(`[RateLimit Error for ${policy}]:`, err);
    if (config.failMode === "closed") {
      throw new RateLimitUnavailableError();
    }
    // Fail open: fallback to in-memory sliding window
    return checkMemoryLimit(policy, key, config);
  }
}

/**
 * Global OTP daily cap per UTC day.
 * Default 300 from env OTP_DAILY_CAP.
 * Over the cap: refuse the send and console.error("OTP DAILY CAP REACHED").
 */
export async function otpDailyCap(): Promise<{ ok: boolean }> {
  const cap = parseInt(process.env.OTP_DAILY_CAP || "300", 10);
  const utcDay = new Date().toISOString().split("T")[0];
  const capKey = `otp_daily_cap:${utcDay}`;

  const redis = getRedisClient();

  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      throw new RateLimitUnavailableError();
    }

    if (!hasLoggedDevWarning) {
      console.warn(
        "[RateLimit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing. Using in-memory daily cap."
      );
      hasLoggedDevWarning = true;
    }

    const current = (dailyMemoryStore.get(capKey) || 0) + 1;
    dailyMemoryStore.set(capKey, current);

    if (current > cap) {
      console.error("OTP DAILY CAP REACHED");
      return { ok: false };
    }

    return { ok: true };
  }

  try {
    const count = await redis.incr(capKey);
    if (count === 1) {
      await redis.expire(capKey, 86400 * 2);
    }

    if (count > cap) {
      console.error("OTP DAILY CAP REACHED");
      return { ok: false };
    }

    return { ok: true };
  } catch (err) {
    console.error("[RateLimit Error in otpDailyCap]:", err);
    throw new RateLimitUnavailableError();
  }
}
