import React from "react";
import Image from "next/image";

export function ProductSwatchImage({
  url,
  category,
  productName,
  altText,
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw",
  priority = false,
}: {
  url?: string;
  category: string;
  productName?: string;
  altText?: string | null;
  sizes?: string;
  priority?: boolean;
}) {
  const alt = altText || productName || category;

  if (url) {
    return (
      <div className="w-full aspect-[4/5] relative overflow-hidden rounded-2xl bg-white border border-stone/30 shadow-[0_8px_24px_rgba(0,0,0,0.07)] transition-all duration-300 group-hover:shadow-[0_12px_32px_rgba(0,0,0,0.12)] group-hover:-translate-y-0.5">
        <Image
          src={url}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <div className="w-full aspect-[4/5] relative overflow-hidden rounded-2xl bg-white border border-stone/30 shadow-[0_8px_24px_rgba(0,0,0,0.07)] transition-all duration-300 group-hover:shadow-[0_12px_32px_rgba(0,0,0,0.12)] group-hover:-translate-y-0.5" />
  );
}
