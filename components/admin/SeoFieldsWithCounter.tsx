"use client";

import { useState } from "react";

export function SeoFieldsWithCounter({
  defaultTitle = "",
  defaultDescription = "",
}: {
  defaultTitle?: string;
  defaultDescription?: string;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark">
            SEO TITLE
          </label>
          <span className="text-[10.5px] font-mono text-stone-dark">
            {title.length} / 70
          </span>
        </div>
        <input
          name="seoTitle"
          maxLength={70}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="SEO title (max 70 chars)"
          className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark">
            SEO DESCRIPTION
          </label>
          <span className="text-[10.5px] font-mono text-stone-dark">
            {description.length} / 160
          </span>
        </div>
        <textarea
          name="seoDescription"
          maxLength={160}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="SEO description (max 160 chars)"
          rows={3}
          className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
        />
      </div>
    </>
  );
}
