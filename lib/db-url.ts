/**
 * Appends `connection_limit=<limit>` to a database URL during `next build`
 * (`phase-production-build`) if not already present, keeping build-time
 * connection usage bounded without altering runtime pooling.
 */
export function withBuildConnectionLimit(
  url: string | undefined,
  phase: string | undefined,
  limit = 2
): string | undefined {
  if (!url || phase !== "phase-production-build") {
    return url;
  }

  const qIdx = url.indexOf("?");
  if (qIdx === -1) {
    return `${url}?connection_limit=${limit}`;
  }

  const query = url.slice(qIdx + 1);
  if (/(?:^|&)connection_limit=/.test(query)) {
    return url;
  }

  const sep = query.length > 0 && !query.endsWith("&") ? "&" : "";
  return `${url}${sep}connection_limit=${limit}`;
}
