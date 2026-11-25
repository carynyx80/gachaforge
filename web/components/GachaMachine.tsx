// Original gacha capsule machine illustration (pure SVG).
const CAPS = [
  [92, 118, '#B6FF2E'], [128, 104, '#D4FF7A'], [164, 120, '#F4F7EE'], [200, 108, '#B6FF2E'],
  [110, 150, '#7CFF6B'], [146, 140, '#B6FF2E'], [182, 152, '#3DDC97'], [216, 142, '#D4FF7A'],
  [96, 182, '#FFD166'], [132, 176, '#F4F7EE'], [170, 186, '#B6FF2E'], [206, 178, '#7CFF6B'],
] as const;

export function GachaMachine({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 400" className={className} role="img" aria-label="GachaForge capsule machine">
      <defs>
        <radialGradient id="gm-glass" cx=".4" cy=".35" r=".8">
          <stop offset="0" stopColor="#D4FF7A" stopOpacity=".25" />
          <stop offset="1" stopColor="#0E0F0C" stopOpacity=".2" />
        </radialGradient>
        <linearGradient id="gm-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C8FF5A" />
          <stop offset="1" stopColor="#5E9410" />
        </linearGradient>
        <filter id="gm-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* top cap */}
      <rect x="62" y="40" width="176" height="26" rx="10" fill="url(#gm-body)" stroke="#D4FF7A" strokeWidth="2" filter="url(#gm-glow)" />
      <text x="150" y="58" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="700" fontSize="13" fill="#050505" letterSpacing="3">FORGE</text>
      {/* globe */}
      <rect x="70" y="66" width="160" height="150" rx="18" fill="url(#gm-glass)" stroke="#B6FF2E" strokeWidth="3" filter="url(#gm-glow)" />
      <g>
        {CAPS.map(([x, y, c], i) => (
          <g key={i} className="gm-cap" style={{ animationDelay: `${i * 0.18}s` }}>
            <circle cx={x} cy={y} r="15" fill={c} />
            <path d={`M${x - 15} ${y} a15 15 0 0 0 30 0z`} fill="#050505" opacity=".35" />
            <circle cx={x - 5} cy={y - 6} r="3.5" fill="#fff" opacity=".6" />
          </g>
        ))}
      </g>
      <path d="M86 80 q8 -6 24 -6" stroke="#fff" strokeOpacity=".5" strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* body */}
      <path d="M58 216 h184 l-8 150 a10 10 0 0 1 -10 9 H76 a10 10 0 0 1 -10 -9 z" fill="url(#gm-body)" stroke="#D4FF7A" strokeWidth="2" filter="url(#gm-glow)" />
      {/* screen */}
      <rect x="84" y="232" width="132" height="34" rx="6" fill="#050505" stroke="#1F2419" />
      <text x="150" y="255" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="14" fill="#3DDC97" className="gm-blink">$ READY TO RIP</text>
      {/* crank */}
      <g className="gm-crank" style={{ transformOrigin: '110px 310px' }}>
        <circle cx="110" cy="310" r="24" fill="#F4F7EE" stroke="#050505" strokeWidth="3" />
        <rect x="104" y="290" width="12" height="40" rx="5" fill="#050505" />
      </g>
      {/* chute */}
      <rect x="160" y="290" width="54" height="48" rx="8" fill="#050505" stroke="#1F2419" strokeWidth="2" />
      <circle cx="187" cy="322" r="11" fill="#B6FF2E" filter="url(#gm-glow)" />
      <path d="M176 322 a11 11 0 0 0 22 0z" fill="#F4F7EE" />
      {/* feet */}
      <rect x="74" y="374" width="30" height="10" rx="3" fill="#1F2419" />
      <rect x="196" y="374" width="30" height="10" rx="3" fill="#1F2419" />
    </svg>
  );
}
