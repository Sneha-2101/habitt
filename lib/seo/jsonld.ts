import { stripMarkupAndCollapse } from "@/lib/seo/metadata";

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined && item !== null) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

export function formatInrPrice(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function serializeJsonLd(obj: unknown): string {
  return JSON.stringify(stripUndefined(obj))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export interface ProductJsonLdInput {
  name: string;
  description: string;
  url: string;
  images: string[];
  brandName: string;
  sku?: string | null;
  variants: Array<{
    pricePaise: number;
    stock: number;
    sku?: string | null;
  }>;
  returnWindowDays: number;
  freeReturnShipping: boolean;
  shippingFeePaise: number;
  freeShippingOnPrepaid: boolean;
  maxDeliveryDays: number;
}

export function productJsonLd(input: ProductJsonLdInput) {
  const prices = input.variants.map((v) => v.pricePaise);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const hasStock = input.variants.some((v) => v.stock > 0);
  const availability = hasStock
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock";
  const firstSku =
    input.sku || input.variants.find((v) => v.sku)?.sku || undefined;

  const hasMerchantReturnPolicy = {
    "@type": "MerchantReturnPolicy",
    applicableCountry: "IN",
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: input.returnWindowDays,
    returnFees: input.freeReturnShipping
      ? "https://schema.org/FreeReturn"
      : "https://schema.org/ReturnFeesCustomerResponsibility",
  };

  const effectiveShippingPaise = input.freeShippingOnPrepaid
    ? 0
    : input.shippingFeePaise;

  const shippingDetails = {
    "@type": "OfferShippingDetails",
    shippingRate: {
      "@type": "MonetaryAmount",
      value: formatInrPrice(effectiveShippingPaise),
      currency: "INR",
    },
    shippingDestination: {
      "@type": "DefinedRegion",
      addressCountry: "IN",
    },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      transitTime: {
        "@type": "QuantitativeValue",
        minValue: 1,
        maxValue: input.maxDeliveryDays,
        unitCode: "DAY",
      },
    },
  };

  const offers =
    minPrice === maxPrice
      ? {
          "@type": "Offer",
          price: formatInrPrice(minPrice),
          priceCurrency: "INR",
          availability,
          itemCondition: "https://schema.org/NewCondition",
          url: input.url,
          hasMerchantReturnPolicy,
          shippingDetails,
        }
      : {
          "@type": "AggregateOffer",
          lowPrice: formatInrPrice(minPrice),
          highPrice: formatInrPrice(maxPrice),
          offerCount: input.variants.length,
          priceCurrency: "INR",
          availability,
          itemCondition: "https://schema.org/NewCondition",
          hasMerchantReturnPolicy,
          shippingDetails,
        };

  return stripUndefined({
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    description: stripMarkupAndCollapse(input.description),
    sku: firstSku,
    image: input.images.filter(Boolean),
    brand: {
      "@type": "Brand",
      name: input.brandName,
    },
    url: input.url,
    offers,
  });
}

export function organizationJsonLd(input: {
  name: string;
  legalName?: string | null;
  url: string;
  logo?: string | null;
  sameAs?: Array<string | null | undefined>;
  email?: string | null;
  phone?: string | null;
  address?: {
    streetAddress?: string | null;
    addressLocality?: string | null;
    addressRegion?: string | null;
    postalCode?: string | null;
    addressCountry?: string;
  } | null;
}) {
  const sameAsList = (input.sameAs || []).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  );
  const hasAddress =
    input.address &&
    (input.address.streetAddress ||
      input.address.addressLocality ||
      input.address.addressRegion ||
      input.address.postalCode);

  return stripUndefined({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    legalName: input.legalName || undefined,
    url: input.url,
    logo: input.logo || undefined,
    sameAs: sameAsList.length > 0 ? sameAsList : undefined,
    contactPoint:
      input.email || input.phone
        ? {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: input.email || undefined,
            telephone: input.phone || undefined,
          }
        : undefined,
    address: hasAddress
      ? {
          "@type": "PostalAddress",
          streetAddress: input.address?.streetAddress || undefined,
          addressLocality: input.address?.addressLocality || undefined,
          addressRegion: input.address?.addressRegion || undefined,
          postalCode: input.address?.postalCode || undefined,
          addressCountry: input.address?.addressCountry || "IN",
        }
      : undefined,
  });
}

export function websiteJsonLd(input: { name: string; url: string }) {
  return stripUndefined({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: input.name,
    url: input.url,
  });
}

export function breadcrumbJsonLd(
  items: Array<{ name: string; url: string }>
) {
  return stripUndefined({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: it.name,
      item: it.url,
    })),
  });
}
