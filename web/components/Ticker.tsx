import type { ActivityEvent } from '@/lib/types';
import { ago } from '@/lib/format';

const COLOR: Record<ActivityEvent['kind'], string> = {
  TAX: 'text-glow', PULL_WON: 'text-success', PULL_SOLD: 'text-muted', PAYOUT: 'text-success', BURN: 'text-danger', NEW_MACHINE: 'text-accent',
};
const ICON: Record<ActivityEvent['kind'], string> = { TAX: '◆', PULL_WON: '★', PULL_SOLD: '↺', PAYOUT: '⬇', BURN: '🔥', NEW_MACHINE: '+' };

export function Ticker({ events }: { events: ActivityEvent[] }) {
  const row = events.map((e) => (
    <span key={e.id} className="mx-5 inline-flex items-center gap-2 whitespace-nowrap text-sm">
      <span className={COLOR[e.kind]}>{ICON[e.kind]}</span>
      <span className="font-display font-bold text-fg">${e.ticker}</span>
      <span className="text-muted">{e.text}</span>
      <span className="font-mono text-xs text-muted/60">{ago(e.timestamp)}</span>
    </span>
  ));
  return (
    <div className="marquee relative overflow-hidden border-b border-line bg-surface py-2.5">
      <div className="marquee-track inline-flex">
        <div className="inline-flex">{row}</div>
        <div className="inline-flex" aria-hidden>{row}</div>
      </div>
    </div>
  );
}
