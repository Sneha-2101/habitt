/**
 * Indian Financial Year utilities.
 * An Indian Financial Year starts on April 1 and ends on March 31 of the following calendar year.
 * Evaluated strictly in Indian Standard Time (Asia/Kolkata, UTC+05:30).
 */

/**
 * Returns the Indian Financial Year string (e.g. "2026-27") for a given date in Asia/Kolkata timezone.
 */
export function getIndianFinancialYear(date: Date = new Date()): string {
  // Convert date to IST parts
  const formatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });

  const parts = formatter.formatToParts(date);
  let year = 0;
  let month = 0;

  for (const part of parts) {
    if (part.type === "year") year = parseInt(part.value, 10);
    if (part.type === "month") month = parseInt(part.value, 10);
  }

  // If month is Jan, Feb, Mar (1, 2, 3), FY started in previous calendar year
  const startYear = month >= 4 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");

  return `${startYear}-${endYearShort}`;
}
