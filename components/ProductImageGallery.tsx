"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { imagesForColor } from "@/lib/catalog/image-color";
import { useProductColor } from "@/components/ProductColorContext";

export interface GalleryImageItem {
  id?: string;
  url: string;
  altText?: string | null;
  color?: string | null;
  position?: number;
}

export default function ProductImageGallery({
  url,
  images,
  category,
  productName,
  altText,
  priority = true,
}: {
  url?: string;
  images?: GalleryImageItem[];
  category: string;
  productName?: string;
  altText?: string | null;
  priority?: boolean;
}) {
  const colorCtx = useProductColor();
  const selectedColor = colorCtx?.selectedColor ?? "";
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomPosition, setZoomPosition] = useState<{ x: number; y: number } | null>(null);

  const visibleImages: GalleryImageItem[] =
    images && images.length > 0
      ? imagesForColor(images, selectedColor)
      : url
      ? [{ url, altText }]
      : [];

  useEffect(() => {
    setActiveIndex(0);
  }, [selectedColor]);

  const current = visibleImages[activeIndex] ?? visibleImages[0];
  const currentUrl = current?.url;
  const alt = current?.altText || altText || productName || category;

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setZoomPosition({ x, y });
  }

  function handleMouseLeave() {
    setZoomPosition(null);
  }

  if (!currentUrl) {
    return (
      <div className="w-full aspect-[4/5] relative overflow-hidden rounded-2xl bg-white border border-stone/30" />
    );
  }

  return (
    <div className="space-y-3">
      <div
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="w-full aspect-[4/5] relative overflow-hidden rounded-2xl bg-white border border-stone/30 shadow-[0_10px_30px_rgba(0,0,0,0.08)] cursor-zoom-in"
      >
        <Image
          src={currentUrl}
          alt={alt}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          priority={priority}
          className="object-cover transition-transform duration-200"
          style={{
            transformOrigin: zoomPosition ? `${zoomPosition.x}% ${zoomPosition.y}%` : "center center",
            transform: zoomPosition ? "scale(1.8)" : "scale(1)",
          }}
        />
      </div>
      {visibleImages.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {visibleImages.map((img, idx) => (
            <button
              key={img.id ?? `${img.url}-${idx}`}
              type="button"
              onClick={() => setActiveIndex(idx)}
              className={`relative w-16 h-20 shrink-0 overflow-hidden rounded-lg border ${
                idx === activeIndex ? "border-ink ring-1 ring-ink" : "border-stone/50 hover:border-ink"
              }`}
              aria-label={`View image ${idx + 1}`}
            >
              <Image
                src={img.url}
                alt={img.altText || productName || category}
                fill
                sizes="64px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
