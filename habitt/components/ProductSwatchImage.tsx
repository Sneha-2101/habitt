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
      <div className="w-full aspect-[4/5] relative overflow-hidden bg-card border-b border-stone/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={category}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  // Fallback procedural swatch inspired by habitt_prototype.jsx
  const categoryColors: Record<string, string> = {
    SHIRTS: "#C9BFA8",
    OVERSHIRTS: "#5B5548",
    POLOS: "#3F4A3D",
    TROUSERS: "#2B2926",
  };
  const color = categoryColors[category] || "#A8492F";

  return (
    <div
      className="w-full aspect-[4/5] relative overflow-hidden"
      style={{
        background: `linear-gradient(155deg, ${color} 0%, ${color}CC 55%, #FBF9F5 150%)`,
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 14px)",
        }}
      />
      <div
        className="absolute top-[38%] left-0 right-0 h-[1px] bg-white/35 -rotate-2"
      />
    </div>
  );
}
