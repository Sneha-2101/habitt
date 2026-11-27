import { describe, it, expect, afterEach, vi } from "vitest";
import { isProductionBuild, readOrBuildFallback } from "@/lib/build-safe";

describe("lib/build-safe", () => {
  const originalPhase = process.env.NEXT_PHASE;

  afterEach(() => {
    if (originalPhase === undefined) {
      delete process.env.NEXT_PHASE;
    } else {
      process.env.NEXT_PHASE = originalPhase;
    }
    vi.restoreAllMocks();
  });

  it("detects production build phase via NEXT_PHASE", () => {
    delete process.env.NEXT_PHASE;
    expect(isProductionBuild()).toBe(false);

    process.env.NEXT_PHASE = "phase-production-server";
    expect(isProductionBuild()).toBe(false);

    process.env.NEXT_PHASE = "phase-production-build";
    expect(isProductionBuild()).toBe(true);
  });

  it("returns fallback and logs only label during production build when read throws", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secretErrorMsg = "P1001: secret-host.example:5432 unreachable";

    const result = await readOrBuildFallback(
      async () => {
        throw new Error(secretErrorMsg);
      },
      { ok: "fallback" },
      "getSettings"
    );

    expect(result).toEqual({ ok: "fallback" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("getSettings");
    expect(logged).not.toContain(secretErrorMsg);
    expect(logged).not.toContain("secret-host.example");
  });

  it("rethrows unchanged at runtime when read throws", async () => {
    delete process.env.NEXT_PHASE;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = new Error("runtime db failure");

    await expect(
      readOrBuildFallback(
        async () => {
          throw boom;
        },
        { ok: "fallback" },
        "getSettings"
      )
    ).rejects.toBe(boom);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns read value on success in both build and runtime phases", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    await expect(
      readOrBuildFallback(async () => ({ ok: "live-build" }), { ok: "fallback" }, "test")
    ).resolves.toEqual({ ok: "live-build" });

    process.env.NEXT_PHASE = "phase-production-server";
    await expect(
      readOrBuildFallback(async () => ({ ok: "live-runtime" }), { ok: "fallback" }, "test")
    ).resolves.toEqual({ ok: "live-runtime" });
  });
});
