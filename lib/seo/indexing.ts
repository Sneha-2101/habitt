export interface IndexingInput {
  seoIndexingEnabled: boolean;
  nodeEnv?: string | undefined;
  vercelEnv?: string | undefined;
  siteUrl: string | null | undefined;
}

function isLocalhostUrl(siteUrl: string): boolean {
  try {
    const parsed = new URL(siteUrl);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host === "0.0.0.0" ||
      host.endsWith(".localhost")
    );
  } catch {
    return true;
  }
}

export function getIndexingBlockedReason(input: IndexingInput): string | null {
  if (!input.seoIndexingEnabled) {
    return "setting off";
  }
  if (input.nodeEnv !== "production") {
    return "not production";
  }
  if (input.vercelEnv && input.vercelEnv !== "production") {
    return "preview deployment";
  }
  if (!input.siteUrl || !input.siteUrl.startsWith("https://") || isLocalhostUrl(input.siteUrl)) {
    return "no https site URL";
  }
  return null;
}

export function isIndexingAllowed(input: IndexingInput): boolean {
  return getIndexingBlockedReason(input) === null;
}
