export function LogoMark({ size = 32 }: { size?: number }) {
  // Original mark: a split gacha capsule sitting on an anvil.
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id="lg-cap" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#D4FF7A" />
          <stop offset="1" stopColor="#B6FF2E" />
        </linearGradient>
      </defs>
      <path d="M20 4a11 11 0 0 1 11 11H9A11 11 0 0 1 20 4Z" fill="url(#lg-cap)" />
      <path d="M9 17h22a11 11 0 0 1-3 7H12a11 11 0 0 1-3-7Z" fill="#F4F7EE" />
      <circle cx="16" cy="10" r="2" fill="#fff" opacity=".7" />
      <path d="M5 27h30l-4 4h-6l2 5H13l2-5H9z" fill="#1F2419" stroke="#B6FF2E" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="font-display text-xl font-bold tracking-wide">
        GACHA<span className="text-accent">FORGE</span>
      </span>
    </span>
  );
}
