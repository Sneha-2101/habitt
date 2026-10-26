"use client";

interface SizeGuideModalProps {
  category: string;
  onClose: () => void;
}

export default function SizeGuideModal({ category, onClose }: SizeGuideModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-stone p-6 rounded-2xl max-w-md w-full relative shadow-2xl space-y-4 animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center pb-3 border-b border-stone/50">
          <h3 className="font-display text-lg text-ink font-medium">Size Guide — {category}</h3>
          <button type="button" onClick={onClose} className="text-stone-dark hover:text-ink text-sm p-1">
            ✕
          </button>
        </div>

        <p className="text-xs text-stone-dark leading-relaxed">
          All measurements are in inches. Habitt garments are tailored for a comfortable, honest fit with a relaxed silhouette.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-stone bg-paper text-stone-dark uppercase font-mono text-[10.5px]">
                <th className="py-2 px-3">Size</th>
                <th className="py-2 px-3">Chest (in)</th>
                <th className="py-2 px-3">Length (in)</th>
                <th className="py-2 px-3">Shoulder (in)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/40 font-mono text-[12px]">
              <tr>
                <td className="py-2 px-3 font-semibold text-ink">S</td>
                <td className="py-2 px-3">38 - 40</td>
                <td className="py-2 px-3">27.5</td>
                <td className="py-2 px-3">18.0</td>
              </tr>
              <tr>
                <td className="py-2 px-3 font-semibold text-ink">M</td>
                <td className="py-2 px-3">40 - 42</td>
                <td className="py-2 px-3">28.5</td>
                <td className="py-2 px-3">18.5</td>
              </tr>
              <tr>
                <td className="py-2 px-3 font-semibold text-ink">L</td>
                <td className="py-2 px-3">42 - 44</td>
                <td className="py-2 px-3">29.5</td>
                <td className="py-2 px-3">19.2</td>
              </tr>
              <tr>
                <td className="py-2 px-3 font-semibold text-ink">XL</td>
                <td className="py-2 px-3">44 - 46</td>
                <td className="py-2 px-3">30.5</td>
                <td className="py-2 px-3">20.0</td>
              </tr>
              <tr>
                <td className="py-2 px-3 font-semibold text-ink">XXL</td>
                <td className="py-2 px-3">46 - 48</td>
                <td className="py-2 px-3">31.5</td>
                <td className="py-2 px-3">20.8</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="pt-2 border-t border-stone/40 text-[11px] text-stone-dark">
          💡 <strong>Fit Tip:</strong> If you prefer a tailored fit, choose your exact size. For an oversized look, size up.
        </div>
      </div>
    </div>
  );
}
