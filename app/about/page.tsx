import React from "react";
import Link from "next/link";
import { CareTag } from "@/components/CareTag";
import { getSettings } from "@/lib/settings";

export default async function AboutPage() {
  const settings = await getSettings();

  return (
    <main className="px-4 sm:px-7 py-12 md:py-20 max-w-4xl mx-auto">
      {/* Editorial Header */}
      <div className="border-b border-stone pb-10 mb-12">
        <CareTag>OUR PHILOSOPHY</CareTag>
        <h1 className="font-display italic text-4xl sm:text-5xl md:text-6xl font-medium leading-[1.08] mt-4 mb-6">
          Clothes with a quiet weight to them.
        </h1>
        <p className="text-lg md:text-xl text-[#4B473F] leading-relaxed max-w-2xl">
          {settings.businessName} was founded on a simple premise: garments should feel considered, honest, and built to endure beyond seasonal noise.
        </p>
      </div>

      {/* Narrative Section 1 */}
      <div className="grid md:grid-cols-2 gap-10 items-start mb-16">
        <div>
          <h2 className="font-display italic text-2xl font-medium mb-3 text-ink">
            Heavier Fabrics & Honest Fits
          </h2>
          <p className="text-[14.5px] text-[#4B473F] leading-relaxed">
            We source natural cottons, linens, and heavyweight knits that carry structure without feeling restrictive. Every seams, placket, and hem is tailored to drape naturally on the body without shouting for attention.
          </p>
        </div>
        <div className="bg-card rounded-2xl p-6 border border-stone/30 shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
          <div className="font-mono text-xs tracking-wider text-moss uppercase mb-2">
            GARMENT STANDARD 01 / CRAFT
          </div>
          <p className="font-mono text-[13px] text-stone-dark leading-relaxed">
            MATERIALS: 100% HEAVYWEIGHT COTTON & NATURAL LINEN
            <br />
            CONSTRUCTION: REINFORCED SEAMS & MONOSPACE PLACKET CREASE
            <br />
            ORIGIN: ETHICALLY CRAFTED & TESTED FOR LONGEVITY
          </p>
        </div>
      </div>

      {/* Narrative Section 2 */}
      <div className="bg-card rounded-2xl p-8 border border-stone/30 shadow-[0_8px_24px_rgba(0,0,0,0.06)] mb-16">
        <h2 className="font-display italic text-2xl font-medium mb-4 text-ink">
          Made to be Worn In, Not Worn Out
        </h2>
        <p className="text-[15px] text-[#4B473F] leading-relaxed max-w-3xl mb-6">
          Fast fashion prioritizes novelty over substance. We craft essential everyday staples that age gracefully with wear, developing character over time.
        </p>
        <Link
          href="/shop"
          className="inline-block px-7 py-3 bg-ink text-paper text-[12.5px] tracking-[0.06em] uppercase rounded-none hover:opacity-90 transition-opacity"
        >
          EXPLORE THE COLLECTION
        </Link>
      </div>
    </main>
  );
}
