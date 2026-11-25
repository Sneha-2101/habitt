import React from "react";
import { renderContentBlocks } from "@/lib/content/render";

export function ContentBlocks({
  body,
  className = "space-y-3 text-xs text-[#4B473F] leading-relaxed",
}: {
  body: string;
  className?: string;
}) {
  const blocks = renderContentBlocks(body);
  if (blocks.length === 0) return null;

  return (
    <div className={className}>
      {blocks.map((block, idx) => {
        if (block.type === "h2") {
          return (
            <h2 key={idx} className="text-sm font-semibold text-ink pt-2">
              {block.text}
            </h2>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={idx} className="list-disc pl-5 space-y-1">
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={idx}>
            {block.lines.map((line, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                {line}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
