import { describe, it, expect } from "vitest";
import { planSlugChange } from "@/lib/seo/slug-redirects";

describe("seo/slug-redirects", () => {
  it("returns no-op when oldSlug equals newSlug", () => {
    expect(
      planSlugChange({
        productId: "p1",
        oldSlug: "oxford-shirt",
        newSlug: "oxford-shirt",
        existingRedirects: [],
      })
    ).toEqual({ ok: true, createRedirect: false, deleteRedirectIds: [] });
  });

  it("rejects when newSlug is an oldSlug belonging to another product", () => {
    const plan = planSlugChange({
      productId: "p2",
      oldSlug: "tee",
      newSlug: "oxford-shirt",
      existingRedirects: [{ id: "r1", oldSlug: "oxford-shirt", productId: "p1" }],
    });
    expect(plan.ok).toBe(false);
  });

  it("deletes self-redirect when reverting to own oldSlug and creates redirect for current slug", () => {
    const plan = planSlugChange({
      productId: "p1",
      oldSlug: "oxford-shirt-v2",
      newSlug: "oxford-shirt",
      existingRedirects: [{ id: "r1", oldSlug: "oxford-shirt", productId: "p1" }],
    });
    expect(plan).toEqual({
      ok: true,
      createRedirect: true,
      deleteRedirectIds: ["r1"],
    });
  });

  it("skips creating redirect if oldSlug redirect row is already present", () => {
    const plan = planSlugChange({
      productId: "p1",
      oldSlug: "oxford-shirt",
      newSlug: "oxford-shirt-v2",
      existingRedirects: [{ id: "r1", oldSlug: "oxford-shirt", productId: "p1" }],
    });
    expect(plan).toEqual({
      ok: true,
      createRedirect: false,
      deleteRedirectIds: [],
    });
  });
});
