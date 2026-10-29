import { describe, it, expect, afterEach, vi } from "vitest";

describe("Lazy Meta Graph Version in lib/whatsapp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("importing lib/whatsapp does not throw in production with META_GRAPH_VERSION unset, but calling graphVersion() throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("META_GRAPH_VERSION", "");

    // Dynamic import to verify module evaluation does not throw
    const whatsapp = await import("@/lib/whatsapp");
    expect(whatsapp).toBeDefined();
    expect(typeof whatsapp.graphVersion).toBe("function");

    expect(() => whatsapp.graphVersion()).toThrow(
      "META_GRAPH_VERSION is required in production environment"
    );
  });

  it("with META_GRAPH_VERSION set to v21.0, graphVersion() returns v21.0", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("META_GRAPH_VERSION", "v21.0");

    const { graphVersion } = await import("@/lib/whatsapp");
    expect(graphVersion()).toBe("v21.0");
  });

  it("in development with META_GRAPH_VERSION unset, graphVersion() defaults to v20.0", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("META_GRAPH_VERSION", "");

    const { graphVersion } = await import("@/lib/whatsapp");
    expect(graphVersion()).toBe("v20.0");
  });
});
