/**
 * GachaForge mark: a block "F" on a lime tile. The middle arm breaks off into a
 * detached square: the spark off the forge / the token popping out of the machine.
 */
export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className={className}>
      <rect width="40" height="40" rx="9" fill="#B6FF2E" />
      <path d="M11 9h18v6H17v3h6v5h-6v8h-6z" fill="#050505" />
      <rect x="25" y="18" width="5" height="5" fill="#050505" />
    </svg>
  );
}

export function Wordmark({ textClass = '' }: { textClass?: string }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className={`font-display text-[15px] font-extrabold tracking-tight sm:text-xl ${textClass}`}>
        GACHA<span className="text-accent">FORGE</span>
      </span>
    </span>
  );
}
