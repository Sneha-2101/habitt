/**
 * Returns true only when an error thrown by the Razorpay SDK represents a
 * definite 4xx client/validation rejection (excluding 408 Request Timeout),
 * meaning the gateway definitely did NOT create the refund.
 * Timeouts, network errors, 408, 5xx, and unknown error shapes return false
 * (ambiguous outcome: the gateway may have processed the request).
 */
export function isDefiniteGatewayRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const statusCode = (err as { statusCode?: unknown }).statusCode;
  if (typeof statusCode !== "number" || !Number.isFinite(statusCode)) {
    return false;
  }
  return statusCode >= 400 && statusCode < 500 && statusCode !== 408;
}
