import { describe, it, expect } from "vitest";
import { withBuildConnectionLimit } from "@/lib/db-url";

const BUILD_PHASE = "phase-production-build";

describe("lib/db-url withBuildConnectionLimit", () => {
  it("adds connection_limit=2 during production build for URL without query params", () => {
    const url = "postgresql://user:pass@db.example.test:5432/app";
    expect(withBuildConnectionLimit(url, BUILD_PHASE)).toBe(
      "postgresql://user:pass@db.example.test:5432/app?connection_limit=2"
    );
  });

  it("preserves existing query params such as pgbouncer=true during production build", () => {
    const url = "postgresql://user:pass@pooler.example.test:6543/app?pgbouncer=true&sslmode=require";
    expect(withBuildConnectionLimit(url, BUILD_PHASE)).toBe(
      "postgresql://user:pass@pooler.example.test:6543/app?pgbouncer=true&sslmode=require&connection_limit=2"
    );
  });

  it("respects custom limit when provided", () => {
    const url = "postgresql://user:pass@db.example.test:5432/app";
    expect(withBuildConnectionLimit(url, BUILD_PHASE, 4)).toBe(
      "postgresql://user:pass@db.example.test:5432/app?connection_limit=4"
    );
  });

  it("does not modify URL when connection_limit is already present", () => {
    const urlOnly = "postgresql://user:pass@db.example.test:5432/app?connection_limit=5";
    const urlWithOther =
      "postgresql://user:pass@pooler.example.test:6543/app?pgbouncer=true&connection_limit=5";

    expect(withBuildConnectionLimit(urlOnly, BUILD_PHASE)).toBe(urlOnly);
    expect(withBuildConnectionLimit(urlWithOther, BUILD_PHASE)).toBe(urlWithOther);
  });

  it("returns URL unchanged outside production build phase", () => {
    const url = "postgresql://user:pass@pooler.example.test:6543/app?pgbouncer=true";
    expect(withBuildConnectionLimit(url, undefined)).toBe(url);
    expect(withBuildConnectionLimit(url, "phase-production-server")).toBe(url);
    expect(withBuildConnectionLimit(url, "phase-development-server")).toBe(url);
  });

  it("handles undefined URLs safely", () => {
    expect(withBuildConnectionLimit(undefined, BUILD_PHASE)).toBeUndefined();
    expect(withBuildConnectionLimit(undefined, undefined)).toBeUndefined();
  });
});
