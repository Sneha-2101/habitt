/**
 * Cloudflare Turnstile siteverify helper.
 * No secret: allow in development, fail closed in production.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  ip?: string
): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    if (process.env.NODE_ENV === "production") {
      console.error("[Turnstile] TURNSTILE_SECRET_KEY is missing in production. Failing closed.");
      return false;
    }
    // Allow in development
    return true;
  }

  if (!token) {
    return false;
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (ip && ip !== "unknown") {
      formData.append("remoteip", ip);
    }

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!res.ok) {
      console.error(`[Turnstile] Cloudflare siteverify returned HTTP ${res.status}`);
      return false;
    }

    const outcome = await res.json();
    return outcome.success === true;
  } catch (err) {
    console.error("[Turnstile] Error verifying turnstile token:", err);
    return false;
  }
}

