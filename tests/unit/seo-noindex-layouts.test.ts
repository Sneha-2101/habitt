import { describe, it, expect } from "vitest";
import { metadata as ticketMetadata } from "@/app/ticket/layout";
import { metadata as orderMetadata } from "@/app/order/layout";

describe("seo/noindex-layouts", () => {
  it("sets robots index: false, follow: false on app/ticket/layout.tsx", () => {
    expect(ticketMetadata.robots).toEqual({ index: false, follow: false });
  });

  it("sets robots index: false, follow: false on app/order/layout.tsx", () => {
    expect(orderMetadata.robots).toEqual({ index: false, follow: false });
  });
});
