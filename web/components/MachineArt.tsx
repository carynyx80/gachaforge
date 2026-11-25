import { hueOf } from '@/lib/format';

/** Placeholder generated avatar for a machine (until real images exist). */
export function MachineArt({ image, ticker, className = '' }: { image: string; ticker: string; className?: string }) {
  if (!image.startsWith('hue:')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt={ticker} className={`object-cover ${className}`} />;
  }
  const h = hueOf(image);
  return (
    <div className={`relative grid place-items-center overflow-hidden ${className}`}
      style={{ background: `radial-gradient(circle at 30% 25%, hsl(${h} 95% 70%), hsl(${(h + 40) % 360} 85% 30%) 70%, #050505)` }}>
      <div className="absolute h-[62%] w-[62%] rounded-full border-2 border-white/30" style={{ background: `linear-gradient(180deg, hsl(${h} 100% 80%) 0 50%, #F4F7EE 50%)` }} />
      <span className="relative font-display text-lg font-bold text-black/70 drop-shadow">{ticker.slice(0, 2)}</span>
    </div>
  );
}
