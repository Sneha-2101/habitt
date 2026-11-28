"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import { writeAudit } from "@/lib/audit";
import { getSupabaseAdmin } from "@/lib/supabase";
import { MAX_CONTENT_LENGTH } from "@/lib/content/render";
import { ALLOWED_CONTENT_KEYS, isValidCtaHref, saveContentRecord } from "@/lib/content/content";
import { validateImageBuffer } from "@/lib/uploads/image-check";
import { safeErrorSummary } from "@/lib/log-redact";

const MAX_ACTIVE_BANNERS = 8;

const saveContentSchema = z.object({
  key: z.enum(ALLOWED_CONTENT_KEYS),
  title: z.string().trim().max(200).nullish(),
  body: z.string().max(MAX_CONTENT_LENGTH, `Body cannot exceed ${MAX_CONTENT_LENGTH} characters`),
  isPublished: z.boolean(),
});

function isValidBucketImageUrl(val: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  if (supabaseUrl) {
    return val.startsWith(`${supabaseUrl}/storage/v1/object/public/product-images/`);
  }
  return /^https:\/\/.+\/storage\/v1\/object\/public\/product-images\/.+/.test(val);
}

const bannerInputSchema = z
  .object({
    imageUrl: z
      .string()
      .trim()
      .min(1, "Banner image is required")
      .refine(isValidBucketImageUrl, "Image URL must come from the product-images upload bucket"),
    imageAlt: z.string().trim().min(1, "Image alt text is required").max(200),
    heading: z.string().trim().min(1, "Heading is required").max(120, "Heading max 120 characters"),
    subheading: z.string().trim().max(300).nullish(),
    ctaLabel: z.string().trim().max(60).nullish(),
    ctaHref: z
      .string()
      .trim()
      .nullish()
      .refine((v) => !v || isValidCtaHref(v), "CTA link must be https:// or same-site relative /..."),
    sortOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    startsAt: z.date().nullish(),
    endsAt: z.date().nullish(),
  })
  .refine(
    (data) => {
      if (data.startsAt && data.endsAt) {
        return data.startsAt.getTime() < data.endsAt.getTime();
      }
      return true;
    },
    { message: "startsAt must be before endsAt", path: ["endsAt"] }
  );

function revalidateContentPaths() {
  try {
    revalidatePath("/", "layout");
    revalidatePath("/about");
    revalidatePath("/policies/shipping");
    revalidatePath("/policies/returns");
    revalidatePath("/policies/privacy");
    revalidatePath("/policies/terms");
    revalidatePath("/policies/grievance");
    revalidatePath("/sitemap.xml");
    revalidatePath("/admin/content");
  } catch {
    // Safe in non-Next test contexts
  }
}

export async function uploadBannerImageAction(formData: FormData): Promise<{ url: string }> {
  await requireStaff();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Please select an image file to upload.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const { mimeType, ext } = validateImageBuffer(buffer);

  const supabase = getSupabaseAdmin();
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${ext}`;
  const filePath = `banners/${fileName}`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(filePath, buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    console.error("Supabase banner upload error:", safeErrorSummary(error));
    throw new Error("Failed to upload banner image.");
  }

  const { data } = supabase.storage.from("product-images").getPublicUrl(filePath);
  return { url: data.publicUrl };
}

export async function saveContentAction(input: {
  key: string;
  title?: string | null;
  body: string;
  isPublished: boolean;
}) {
  const staff = await requireStaff();
  const parsed = saveContentSchema.parse(input);
  const saved = await saveContentRecord({
    key: parsed.key,
    title: parsed.title,
    body: parsed.body,
    isPublished: parsed.isPublished,
    actorId: staff.id,
  });
  revalidateContentPaths();
  return saved;
}

export async function createBannerAction(input: {
  imageUrl: string;
  imageAlt: string;
  heading: string;
  subheading?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
}) {
  const staff = await requireStaff();
  const parsed = bannerInputSchema.parse({
    ...input,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
  });

  const isActive = parsed.isActive ?? true;
  if (isActive) {
    const activeCount = await prisma.homeBanner.count({ where: { isActive: true } });
    if (activeCount >= MAX_ACTIVE_BANNERS) {
      throw new Error(`Maximum of ${MAX_ACTIVE_BANNERS} active banners allowed.`);
    }
  }

  const maxSort = await prisma.homeBanner.aggregate({ _max: { sortOrder: true } });
  const nextSort = parsed.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1;

  const created = await prisma.homeBanner.create({
    data: {
      imageUrl: parsed.imageUrl,
      imageAlt: parsed.imageAlt,
      heading: parsed.heading,
      subheading: parsed.subheading || null,
      ctaLabel: parsed.ctaLabel || null,
      ctaHref: parsed.ctaHref || null,
      sortOrder: nextSort,
      isActive,
      startsAt: parsed.startsAt ?? null,
      endsAt: parsed.endsAt ?? null,
    },
  });

  await writeAudit({
    actorId: staff.id,
    action: "BANNER_CREATED",
    entity: "HomeBanner",
    entityId: created.id,
    meta: { heading: created.heading, isActive: created.isActive },
  });

  revalidateContentPaths();
  return created;
}

export async function updateBannerAction(
  id: string,
  input: {
    imageUrl?: string;
    imageAlt?: string;
    heading?: string;
    subheading?: string | null;
    ctaLabel?: string | null;
    ctaHref?: string | null;
    sortOrder?: number;
    isActive?: boolean;
    startsAt?: string | Date | null;
    endsAt?: string | Date | null;
  }
) {
  const staff = await requireStaff();
  const existing = await prisma.homeBanner.findUnique({ where: { id } });
  if (!existing) throw new Error("Banner not found.");

  const merged = {
    imageUrl: input.imageUrl ?? existing.imageUrl,
    imageAlt: input.imageAlt ?? existing.imageAlt,
    heading: input.heading ?? existing.heading,
    subheading: input.subheading !== undefined ? input.subheading : existing.subheading,
    ctaLabel: input.ctaLabel !== undefined ? input.ctaLabel : existing.ctaLabel,
    ctaHref: input.ctaHref !== undefined ? input.ctaHref : existing.ctaHref,
    sortOrder: input.sortOrder ?? existing.sortOrder,
    isActive: input.isActive ?? existing.isActive,
    startsAt: input.startsAt !== undefined ? (input.startsAt ? new Date(input.startsAt) : null) : existing.startsAt,
    endsAt: input.endsAt !== undefined ? (input.endsAt ? new Date(input.endsAt) : null) : existing.endsAt,
  };

  const parsed = bannerInputSchema.parse(merged);

  if (!existing.isActive && parsed.isActive) {
    const activeCount = await prisma.homeBanner.count({ where: { isActive: true } });
    if (activeCount >= MAX_ACTIVE_BANNERS) {
      throw new Error(`Maximum of ${MAX_ACTIVE_BANNERS} active banners allowed.`);
    }
  }

  const updated = await prisma.homeBanner.update({
    where: { id },
    data: {
      imageUrl: parsed.imageUrl,
      imageAlt: parsed.imageAlt,
      heading: parsed.heading,
      subheading: parsed.subheading || null,
      ctaLabel: parsed.ctaLabel || null,
      ctaHref: parsed.ctaHref || null,
      sortOrder: parsed.sortOrder ?? existing.sortOrder,
      isActive: parsed.isActive ?? existing.isActive,
      startsAt: parsed.startsAt ?? null,
      endsAt: parsed.endsAt ?? null,
    },
  });

  await writeAudit({
    actorId: staff.id,
    action: "BANNER_UPDATED",
    entity: "HomeBanner",
    entityId: updated.id,
    meta: { heading: updated.heading, isActive: updated.isActive },
  });

  revalidateContentPaths();
  return updated;
}

export async function deleteBannerAction(id: string) {
  const staff = await requireStaff();
  await prisma.homeBanner.delete({ where: { id } });
  await writeAudit({
    actorId: staff.id,
    action: "BANNER_DELETED",
    entity: "HomeBanner",
    entityId: id,
  });
  revalidateContentPaths();
  return { success: true };
}

export async function reorderBannersAction(orderedIds: string[]) {
  const staff = await requireStaff();
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.homeBanner.update({
        where: { id: orderedIds[i] },
        data: { sortOrder: i },
      });
    }
  });
  await writeAudit({
    actorId: staff.id,
    action: "BANNERS_REORDERED",
    entity: "HomeBanner",
    entityId: "bulk",
    meta: { count: orderedIds.length },
  });
  revalidateContentPaths();
  return { success: true };
}
