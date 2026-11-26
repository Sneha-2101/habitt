import { stripMarkupAndCollapse } from "@/lib/seo/metadata";
import { formatInrPrice } from "@/lib/seo/jsonld";

export function escapeXml(str: string): string {
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface GoogleFeedVariantItem {
  productId: string;
  variantId: string;
  sku?: string | null;
  title: string;
  description: string;
  slug: string;
  imageUrl: string;
  pricePaise: number;
  stock: number;
  color?: string | null;
  size?: string | null;
}

export function buildGoogleFeedXml(input: {
  items: GoogleFeedVariantItem[];
  siteUrl: string;
  displayName: string;
}): string {
  const baseUrl = input.siteUrl.replace(/\/+$/, "");
  const channelTitle = escapeXml(input.displayName);

  const itemXml = input.items
    .map((it) => {
      const gid = escapeXml(it.sku?.trim() || `${it.productId}-${it.variantId}`);
      const title = escapeXml(it.title);
      const desc = escapeXml(stripMarkupAndCollapse(it.description));
      const link = escapeXml(`${baseUrl}/product/${it.slug}`);
      const img = escapeXml(it.imageUrl);
      const avail = it.stock > 0 ? "in_stock" : "out_of_stock";
      const price = `${formatInrPrice(it.pricePaise)} INR`;
      const brand = escapeXml(input.displayName);
      const groupId = escapeXml(it.productId);
      const colorTag = it.color?.trim()
        ? `\n      <g:color>${escapeXml(it.color.trim())}</g:color>`
        : "";
      const sizeTag = it.size?.trim()
        ? `\n      <g:size>${escapeXml(it.size.trim())}</g:size>`
        : "";

      return `    <item>
      <g:id>${gid}</g:id>
      <title>${title}</title>
      <description>${desc}</description>
      <link>${link}</link>
      <g:image_link>${img}</g:image_link>
      <g:availability>${avail}</g:availability>
      <g:price>${price}</g:price>
      <g:brand>${brand}</g:brand>
      <g:condition>new</g:condition>
      <g:item_group_id>${groupId}</g:item_group_id>${colorTag}${sizeTag}
      <g:identifier_exists>no</g:identifier_exists>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${channelTitle}</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>${channelTitle} Product Feed</description>
${itemXml}
  </channel>
</rss>`;
}
