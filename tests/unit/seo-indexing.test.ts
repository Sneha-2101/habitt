import { describe, it, expect } from "vitest";
import { getIndexingBlockedReason, isIndexingAllowed } from "@/lib/seo/indexing";

describe("seo/indexing", () => {
  it("blocks indexing when seoIndexingEnabled is false", () => {
    expect(
      getIndexingBlockedReason({
        seoIndexingEnabled: false,
        nodeEnv: "production",
        vercelEnv: "production",
        siteUrl: "https://habitt.in",
      })
    ).toBe("setting off");
    expect(
      isIndexingAllowed({
        seoIndexingEnabled: false,
        nodeEnv: "production",
        vercelEnv: "production",
        siteUrl: "https://habitt.in",
      })
    ).toBe(false);
  });

  it("blocks indexing when nodeEnv is not production", () => {
    expect(
      getIndexingBlockedReason({
        seoIndexingEnabled: true,
        nodeEnv: "development",
        vercelEnv: "production",
        siteUrl: "https://habitt.in",
      })
    ).toBe("not production");
  });

  it("blocks indexing on vercel preview deployments", () => {
    expect(
      getIndexingBlockedReason({
        seoIndexingEnabled: true,
        nodeEnv: "production",
        vercelEnv: "preview",
        siteUrl: "https://preview.habitt.in",
      })
    ).toBe("preview deployment");
  });

  it("blocks indexing for missing, http, or localhost siteUrl", () => {
    for (const url of [null, "", "http://habitt.in", "https://localhost:3000", "https://127.0.0.1"]) {
      expect(
        getIndexingBlockedReason({
          seoIndexingEnabled: true,
          nodeEnv: "production",
          vercelEnv: "production",
          siteUrl: url,
        })
      ).toBe("no https site URL");
    }
  });

  it("allows indexing only when all production conditions are met", () => {
    expect(
      isIndexingAllowed({
        seoIndexingEnabled: true,
        nodeEnv: "production",
        vercelEnv: "production",
        siteUrl: "https://habitt.in",
      })
    ).toBe(true);
    expect(
      isIndexingAllowed({
        seoIndexingEnabled: true,
        nodeEnv: "production",
        vercelEnv: undefined,
        siteUrl: "https://habitt.in",
      })
    ).toBe(true);
  });
});
