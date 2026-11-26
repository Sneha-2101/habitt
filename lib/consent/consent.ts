export const CONSENT_COOKIE_NAME = "habitt_consent";
export const CONSENT_GRANTED_VALUE = "granted";
export const CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60; // 180 days
export const CONSENT_EVENT = "habitt:consent";
export const CONSENT_OPEN_EVENT = "habitt:consent-open";
const DISMISS_STORAGE_KEY = "habitt_consent_dismissed";

export type ConsentState = "granted" | "unset";

export function parseConsent(cookieString: string | null | undefined): ConsentState {
  if (!cookieString) return "unset";
  const parts = cookieString.split(";");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (name === CONSENT_COOKIE_NAME && val === CONSENT_GRANTED_VALUE) {
      return "granted";
    }
  }
  return "unset";
}

export function shouldLoadPixel(input: {
  pixelId?: string | null;
  consent: ConsentState;
}): boolean {
  const id = input.pixelId?.trim();
  if (!id || id === "YOUR_META_PIXEL_ID") return false;
  return input.consent === "granted";
}

export function purchaseDedupeKey(orderId: string): string {
  return `habitt_pixel_purchase_${orderId}`;
}

export function readConsent(): ConsentState {
  if (typeof document === "undefined") return "unset";
  return parseConsent(document.cookie);
}

export function grantConsent(): void {
  if (typeof document === "undefined") return;
  const secureFlag =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `${CONSENT_COOKIE_NAME}=${CONSENT_GRANTED_VALUE}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secureFlag}`;
  try {
    window.sessionStorage.removeItem(DISMISS_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

export function revokeConsent(): void {
  if (typeof document === "undefined") return;
  const secureFlag =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `${CONSENT_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secureFlag}`;
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

export function isConsentDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DISMISS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissConsentForSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DISMISS_STORAGE_KEY, "1");
  } catch {
    // ignore storage errors
  }
}

export function openConsentNotice(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DISMISS_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}
