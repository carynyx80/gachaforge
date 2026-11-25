import type { Pull } from '@/lib/types';
import { hueOf } from '@/lib/format';

/** Generated slab-style graded card (no real card art). */
export function CardThumb({ card, size = 'sm' }: { card: Pull['card']; size?: 'sm' | 'md' }) {
  const h = hueOf(card.image);
  const w = size === 'sm' ? 'w-11' : 'w-20';
  return (
    <div className={`${w} shrink-0 overflow-hidden rounded-[5px] border border-white/20 bg-[#e9e6ee] p-[2px] shadow-md`}>
      <div className="flex items-center justify-between bg-[#c41d1d] px-1 text-[6px] font-bold leading-[9px] text-white">
        <span>{card.grader}</span><span>{card.grade.split(' ')[0]}</span>
      </div>
      <div
        className="relative mt-[2px] aspect-[5/7] rounded-[2px]"
        style={{ background: `linear-gradient(150deg, hsl(${h} 90% 62%), hsl(${(h + 60) % 360} 80% 35%))` }}
      >
        <div className="absolute inset-[14%] rounded-full border border-white/40" style={{ background: `radial-gradient(circle at 35% 30%, hsl(${(h + 30) % 360} 100% 85%), transparent 70%)` }} />
        <div className="absolute inset-x-[8%] bottom-[6%] h-[14%] rounded-[1px] bg-black/30" />
      </div>
    </div>
  );
}
