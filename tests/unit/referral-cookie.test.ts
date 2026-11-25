import { describe, it, expect, afterEach, vi } from "vitest";
import { GET } from "@/app/r/[code]/route";

describe("r/[code] cookie security", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets Secure attribute on habitt_ref cookie only in production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const devRes = await GET(new Request("http://localhost:3000/r/ABCD2345"), {
      params: Promise.resolve({ code: "ABCD2345" }),
    });
    expect(devRes.status).toBe(307);
    const devCookie = devRes.headers.get("set-cookie") || "";
    expect(devCookie).toContain("habitt_ref=ABCD2345");
    expect(devCookie.toLowerCase()).not.toContain("secure");

    vi.stubEnv("NODE_ENV", "production");
    const prodRes = await GET(new Request("https://habitt.in/r/ABCD2345"), {
      params: Promise.resolve({ code: "ABCD2345" }),
    });
    expect(prodRes.status).toBe(307);
    const prodCookie = prodRes.headers.get("set-cookie") || "";
    expect(prodCookie).toContain("habitt_ref=ABCD2345");
    expect(prodCookie.toLowerCase()).toContain("secure");
  });
});
