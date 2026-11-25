import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../helpers/prisma";
import { SiteSettings } from "@prisma/client";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T103: HTTP Content Pages, Manifest, SW & Offline", () => {
  let originalSettings: SiteSettings | null = null;
  const createdBannerIds: string[] = [];

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
  });

  afterAll(async () => {
    try {
      if (createdBannerIds.length > 0) {
        await prisma.homeBanner.deleteMany({ where: { id: { in: createdBannerIds } } });
      }
      await prisma.siteContent.deleteMany({
        where: { key: { in: ["about", "policy.shipping"] } },
      });
    } finally {
      if (originalSettings) {
        const { id, ...data } = originalSettings;
        await prisma.siteSettings.update({
          where: { id },
          data,
        });
      }
    }
  });

  it("/about renders saved About text and escapes <script> HTML", async () => {
    await prisma.siteContent.upsert({
      where: { key: "about" },
      update: {
        title: "m1test About Us",
        body: "## Story\n\n<script>window.__xss=1</script> Trusted garments.",
        isPublished: true,
      },
      create: {
        key: "about",
        title: "m1test About Us",
        body: "## Story\n\n<script>window.__xss=1</script> Trusted garments.",
        isPublished: true,
      },
    });

    const res = await fetch(`${BASE_URL}/about`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("m1test About Us");
    expect(html).toContain("&lt;script&gt;window.__xss=1&lt;/script&gt;");
    expect(html).not.toContain("<script>window.__xss=1</script>");
  });

  it("active banner shows on / and expired banner does not", async () => {
    const bucketBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co"}/storage/v1/object/public/product-images/banners`;
    const active = await prisma.homeBanner.create({
      data: {
        imageUrl: `${bucketBase}/m1test-active.jpg`,
        imageAlt: "Active Alt",
        heading: "m1test Live Banner Heading",
        isActive: true,
        startsAt: new Date(Date.now() - 3600_000),
        endsAt: new Date(Date.now() + 3600_000),
      },
    });
    const expired = await prisma.homeBanner.create({
      data: {
        imageUrl: `${bucketBase}/m1test-expired.jpg`,
        imageAlt: "Expired Alt",
        heading: "m1test Expired Banner Heading",
        isActive: true,
        startsAt: new Date(Date.now() - 7200_000),
        endsAt: new Date(Date.now() - 3600_000),
      },
    });
    createdBannerIds.push(active.id, expired.id);

    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("m1test Live Banner Heading");
    expect(html).not.toContain("m1test Expired Banner Heading");
  });

  it("policy page shows generated text first then published notes", async () => {
    await prisma.siteContent.upsert({
      where: { key: "policy.shipping" },
      update: { body: "m1test Extra shipping note", isPublished: true },
      create: { key: "policy.shipping", body: "m1test Extra shipping note", isPublished: true },
    });

    const res = await fetch(`${BASE_URL}/policies/shipping`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const genIdx = html.indexOf("Shipping Charges");
    const noteIdx = html.indexOf("m1test Extra shipping note");
    expect(genIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeGreaterThan(genIdx);
  });

  it("/manifest.webmanifest, /sw.js, and /offline return 200 with expected payloads", async () => {
    const manifestRes = await fetch(`${BASE_URL}/manifest.webmanifest`);
    expect(manifestRes.status).toBe(200);
    const manifestJson = await manifestRes.json();
    expect(manifestJson.start_url).toBe("/");
    expect(typeof manifestJson.name).toBe("string");

    const swRes = await fetch(`${BASE_URL}/sw.js`);
    expect(swRes.status).toBe(200);
    expect(swRes.headers.get("content-type") || "").toMatch(/javascript/i);

    const offRes = await fetch(`${BASE_URL}/offline`);
    expect(offRes.status).toBe(200);
  });
});
