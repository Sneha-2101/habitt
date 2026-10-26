"use client";

import { useState } from "react";

export default function ProductImageGallery({
  url,
  category,
}: {
  url?: string;
  category: string;
}) {
  const [zoomPosition, setZoomPosition] = useState<{ x: number; y: number } | null>(null);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setZoomPosition({ x, y });
  }

  function handleMouseLeave() {
    setZoomPosition(null);
  }

  if (!url) {
    return (
      <div className="w-full aspect-[4/5] relative overflow-hidden rounded-2xl bg-white border border-stone/30" />
    );
  }

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="w-full aspect-[4/5] relative overflow-hidden rounded-2xl bg-white border border-stone/30 shadow-[0_10px_30px_rgba(0,0,0,0.08)] cursor-zoom-in"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={category}
        className="w-full h-full object-cover transition-transform duration-200"
        style={{
          transformOrigin: zoomPosition ? `${zoomPosition.x}% ${zoomPosition.y}%` : "center center",
          transform: zoomPosition ? "scale(1.8)" : "scale(1)",
        }}
      />
    </div>
  );
}
