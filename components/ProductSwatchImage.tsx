import React from "react";

export function ProductSwatchImage({
  url,
  category,
}: {
  url?: string;
  category: string;
}) {
  if (url) {
    return (
      <div className="w-full aspect-[4/5] relative overflow-hidden rounded-2xl bg-white border border-stone/30 shadow-[0_8px_24px_rgba(0,0,0,0.07)] transition-all duration-300 group-hover:shadow-[0_12px_32px_rgba(0,0,0,0.12)] group-hover:-translate-y-0.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={category}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div className="w-full aspect-[4/5] relative overflow-hidden rounded-2xl bg-white border border-stone/30 shadow-[0_8px_24px_rgba(0,0,0,0.07)] transition-all duration-300 group-hover:shadow-[0_12px_32px_rgba(0,0,0,0.12)] group-hover:-translate-y-0.5" />
  );
}
