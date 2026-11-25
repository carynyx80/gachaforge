import { STRATEGY_INFO } from '@/lib/strategies';
import type { Strategy } from '@/lib/types';

export const metadata = { title: 'Docs — GachaForge' };

const SECTIONS = [
  ['overview', 'Overview'], ['how', 'How it works'], ['fees', 'Fees & tax'], ['packs', 'Packs'],
  ['strategies', 'Strategies'], ['rewards', 'Earning rewards'], ['safety', 'Trust & safety'], ['faq', 'FAQ'],
] as const;

const FAQ: [string, string][] = [
  ['Does the creator earn from the tax?', 'No. The creator receives 0% of the tax. Creators hold the token like anyone else and qualify for rewards under the same rules.'],
  ['Can tax, strategy or pack be changed later?', 'No. They are written into the machine at launch and can never be edited — not by the creator and not by the platform.'],
  ['When does the first pull happen?', 'As soon as the gacha pot covers one pack — even while the token is still on the flap.sh bonding curve.'],
  ['How often can a machine pull?', 'One pull can be open per machine at a time, with a cooldown between pulls (60 seconds by default).'],
  ['What happens if no holder is eligible?', 'For raffle-style strategies the card is sold back and the BNB goes back into the pot for the next pull.'],
  ['Can I verify a raffle?', 'Yes. Each raffle publishes the snapshot hash, the random seed and the winner, so anyone can recompute the result.'],
  ['Who holds the physical cards?', 'Cards are graded and held by Renaiss. Winners can keep them or sell them back at the sell-back rate.'],
];

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="scroll-mt-24 font-display text-2xl font-bold uppercase tracking-wide sm:text-3xl"><span className="mr-3 inline-block h-6 w-1.5 rounded-sm bg-accent align-middle shadow-[0_0_12px_#B6FF2E]" />{children}</h2>;
}

export default function DocsPage() {
  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-4 pt-10 lg:grid-cols-[220px_1fr]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted">Docs</div>
        <nav className="mt-3 flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
          {SECTIONS.map(([id, l]) => <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-fg">{l}</a>)}
        </nav>
      </aside>

      <article className="min-w-0 space-y-12 leading-relaxed text-fg/90">
        <section className="space-y-3">
          <H id="overview">Overview</H>
          <p>GachaForge is a meme-token launchpad on BNB Chain with a twist: every token is a <b>gacha machine</b>. Part of each trade&apos;s tax fills a pot, and when the pot covers a pack, the machine pulls a real, graded trading card through Renaiss. What happens to that card is decided by the strategy the creator locked in at launch.</p>
          <p>Tokens launch on <b>flap.sh</b>. The platform token is <b>$FORGE</b>.</p>
        </section>

        <section className="space-y-3">
          <H id="how">How it works</H>
          <ol className="grid gap-3 sm:grid-cols-2">
            {[
              ['Launch', 'A creator picks name, pack, strategy and tax (1–10%). All of it is locked forever.'],
              ['Trade', 'Every buy and sell pays the tax. 70% of what reaches the vault fills the gacha pot.'],
              ['Pull', 'When the pot covers the pack price, the machine opens a pack and receives a graded card.'],
              ['Reward', 'The strategy decides: raffle the card to a holder, or sell it back for dividends, burns or LP.'],
            ].map(([t, d], i) => (
              <li key={t} className="panel p-4"><div className="font-display text-lg font-bold"><span className="text-accent">0{i + 1}</span> {t}</div><p className="mt-1 text-sm text-muted">{d}</p></li>
            ))}
          </ol>
        </section>

        <section className="space-y-3">
          <H id="fees">Fees & tax</H>
          <p>The creator sets one tax rate between 1% and 10% (whole numbers), applied equally to buys and sells. Whatever reaches the machine&apos;s vault is split:</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[['70%', 'Gacha pot'], ['20%', '$FORGE buyback & burn'], ['10%', 'Platform treasury']].map(([p, l]) => (
              <div key={l} className="panel p-4"><div className="font-display text-3xl font-bold text-accent">{p}</div><div className="text-xs text-muted">{l}</div></div>
            ))}
          </div>
          <p className="text-sm text-muted">The creator receives 0%.</p>
          <div className="panel border-accent/40 p-4 text-sm">
            <div className="font-semibold">Worked example</div>
            <p className="mt-1 text-muted">A machine has a 5% tax. Someone buys $1,000 of the token, paying $50 in tax. $35 goes to the gacha pot, $10 buys and burns $FORGE, and $5 goes to the treasury. On a $28 pack, that single trade covers more than one full pull.</p>
          </div>
        </section>

        <section className="space-y-3">
          <H id="packs">Packs</H>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-widest text-muted"><tr><th className="px-4 py-3">Pack</th><th>Price / pull</th><th>Max win</th></tr></thead>
              <tbody className="divide-y divide-line font-mono">
                {[['FORGE_28', '$28', '~10x'], ['FORGE_48', '$48', '~11x'], ['FORGE_88', '$88', '~9.9x']].map(([a, b, c]) => <tr key={a}><td className="px-4 py-3 text-glow">{a}</td><td>{b}</td><td>{c}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">A pull is paid in BNB at the Chainlink BNB/USD price plus a slippage buffer of up to 10%. Anything left over goes back into the pot.</p>
        </section>

        <section className="space-y-3">
          <H id="strategies">Strategies</H>
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(STRATEGY_INFO) as Strategy[]).map((s) => (
              <div key={s} className="panel p-4"><div className="font-display text-lg font-bold">{STRATEGY_INFO[s].icon} {STRATEGY_INFO[s].title}</div><p className="mt-1 text-sm text-muted">{STRATEGY_INFO[s].long}</p></div>
            ))}
          </div>
          <p className="text-sm text-muted">Sell-back rate from Renaiss: 90% of card value within 1 hour, 85% within 24 hours, 50% within 72 hours.</p>
        </section>

        <section className="space-y-3">
          <H id="rewards">Earning rewards</H>
          <p>To be eligible for a round you need to hold at least <b>0.01% of total supply</b> (100,000 tokens on a 1B supply) at the round&apos;s snapshot block. Raffle odds are weighted by balance; dividends are paid pro-rata.</p>
          <p className="text-sm text-muted">Not eligible: liquidity pools and pairs, the token contract, the vault, launchpad contracts, the router and the dead address. The creator counts like any other holder.</p>
        </section>

        <section className="space-y-3">
          <H id="safety">Trust & safety</H>
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              ['Locked settings', 'Tax, split, pack and strategy are immutable after launch.'],
              ['Timelock', 'Admin changes go through a timelock owned by a 2-of-3 multisig.'],
              ['Revocable operator', 'The operator role that runs pulls can be revoked.'],
              ['Emergency pause', 'Launches and pulls can be paused if something goes wrong.'],
              ['Verifiable raffles', 'Snapshot hash, seed and winner are published for every raffle.'],
              ['Real cards', 'Cards are graded (PSA / CGC / BGS) and custodied through Renaiss.'],
            ].map(([t, d]) => <li key={t} className="panel p-4"><div className="font-semibold">{t}</div><p className="text-sm text-muted">{d}</p></li>)}
          </ul>
        </section>

        <section className="space-y-3">
          <H id="faq">FAQ</H>
          <div className="space-y-2">
            {FAQ.map(([q, a]) => (
              <details key={q} className="panel group p-4 open:border-accent/50">
                <summary className="flex cursor-pointer list-none items-center justify-between font-semibold">{q}<span className="text-accent transition group-open:rotate-45">+</span></summary>
                <p className="mt-2 text-sm text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </article>
    </div>
  );
}
