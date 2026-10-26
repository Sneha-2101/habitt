import React from "react";

export function CareTag({
  children,
  dark,
  className = "",
}: {
  children: React.ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`font-mono text-[10px] tracking-[0.08em] px-2 py-[3px] border uppercase opacity-75 inline-block ${
        dark ? "border-paper text-paper" : "border-ink text-ink"
      } ${className}`}
    >
      {children}
    </span>
  );
}
