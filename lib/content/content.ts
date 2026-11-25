import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { MAX_CONTENT_LENGTH } from "@/lib/content/render";
import { isBannerActiveAt } from "@/lib/content/banner-window";

export const ALLOWED_CONTENT_KEYS = [
  "about",
  "policy.shipping",
  "policy.returns",
  "policy.privacy",
  "policy.terms",
  "policy.grievance",
] as const;

export type AllowedContentKey = (typeof ALLOWED_CONTENT_KEYS)[number];

export function isAllowedContentKey(key: string): key is AllowedContentKey {
  return (ALLOWED_CONTENT_KEYS as readonly string[]).includes(key);
}

export async function getContent(key: AllowedContentKey) {
  if (!isAllowedContentKey(key)) {
    throw new Error(`Invalid content key: ${key}`);
  }
  return prisma.siteContent.findUnique({
    where: { key },
  });
}

export async function listContent() {
  const rows = await prisma.siteContent.findMany({
    where: { key: { in: [...ALLOWED_CONTENT_KEYS] } },
  });
  const map = new Map(rows.map((r) => [r.key, r]));
  return ALLOWED_CONTENT_KEYS.map((key) => {
    const existing = map.get(key);
    return (
      existing ?? {
        key,
        title: null,
        body: "",
        isPublished: true,
        updatedById: null,
        updatedAt: new Date(0),
      }
    );
  });
}

export async function saveContentRecord(params: {
  key: string;
  title?: string | null;
  body: string;
  isPublished: boolean;
  actorId: string;
}) {
  if (!isAllowedContentKey(params.key)) {
    throw new Error(`Invalid content key: ${params.key}`);
  }
  if (params.body.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Content body exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
  }

  const existing = await prisma.siteContent.findUnique({
    where: { key: params.key },
  });

  const saved = await prisma.siteContent.upsert({
    where: { key: params.key },
    update: {
      title: params.title?.trim() || null,
      body: params.body,
      isPublished: params.isPublished,
      updatedById: params.actorId,
    },
    create: {
      key: params.key,
      title: params.title?.trim() || null,
      body: params.body,
      isPublished: params.isPublished,
      updatedById: params.actorId,
    },
  });

  await writeAudit({
    actorId: params.actorId,
    action: "CONTENT_UPDATED",
    entity: "SiteContent",
    entityId: params.key,
    meta: {
      beforeLength: existing?.body.length ?? 0,
      afterLength: saved.body.length,
      beforePublished: existing?.isPublished ?? null,
      afterPublished: saved.isPublished,
    },
  });

  return saved;
}

export async function listAllBanners() {
  return prisma.homeBanner.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function getActiveHomeBanners(now: Date = new Date()) {
  const rows = await prisma.homeBanner.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.filter((b) => isBannerActiveAt(b, now));
}
