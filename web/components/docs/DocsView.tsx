'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/components/LangProvider';
import { DOC_SECTIONS, docsDict, type DocSection } from '@/lib/docs-i18n';
import { FLAP_CUT_PCT, PACKS, SPLIT, TAX_PCT, money, volumePerPull } from '@/lib/economics';
import { STRATEGY_INFO } from '@/lib/strategies';
import { addrUrl } from '@/lib/chain';
import type { Strategy } from '@/lib/types';

export type DocAddress = { key: string; address?: string };

const STRATS = Object.keys(STRATEGY_INFO) as Strategy[];

function H({ id, n, children }: { id: string; n: number; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-28 font-display text-xl font-extrabold uppercase tracking-tight sm:text-[1.65rem]">
      <span className="mr-3 font-mono text-base text-accent">{String(n).padStart(2, '0')}</span>{children}
    </h2>
  );
}
const H3 = ({ children }: { children: ReactNode }) => <h3 className="font-display text-lg font-bold uppercase tracking-wide">{children}</h3>;

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded border border-accent/60 font-mono text-xs text-accent">{i + 1}</span>
          <span className="pt-0.5 text-fg/85">{s}</span>
        </li>
      ))}
    </ol>
  );
}

function Bullets({ items, mark = '›' }: { items: string[]; mark?: string }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((s, i) => <li key={i} className="flex gap-2"><span className="text-accent">{mark}</span><span className="text-fg/85">{s}</span></li>)}
    </ul>
  );
}

function Bar({ label, segs }: { label: string; segs: { pct: number; label: string; cls: string }[] }) {
  return (
    <div>
      <div className="mb-1.5 text-xs uppercase tracking-widest text-muted">{label}</div>
      <div className="flex h-9 overflow-hidden rounded-md border border-line">
        {segs.map((s) => (
          <div key={s.label} style={{ width: `${s.pct}%` }} title={`${s.label} ${s.pct}%`}
            className={`grid min-w-[6px] place-items-center font-mono text-[11px] font-bold ${s.cls}`}>
            {s.pct >= 8 ? `${+s.pct.toFixed(1)}%` : ''}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {segs.map((s) => <span key={s.label} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${s.cls}`} />{s.label} <span className="font-mono text-fg">{+s.pct.toFixed(2)}%</span></span>)}
      </div>
    </div>
  );
}

export default function DocsView({ addresses }: { addresses: DocAddress[] }) {
  const { lang, t } = useT();
  const d = docsDict[lang];
  const [active, setActive] = useState<DocSection>('overview');

  useEffect(() => {
    const els = DOC_SECTIONS.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id as DocSection);
    }, { rootMargin: '-15% 0px -70% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  const net = 100 - FLAP_CUT_PCT;
  const segFlap = 'bg-muted/40 text-fg';
  const segPlat = 'bg-surface text-fg border-r border-line';
  const segPot = 'bg-accent text-black';
  const segBuy = 'bg-glow text-black';

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 pb-20 pt-10 lg:grid-cols-[230px_1fr] lg:gap-12">
      <aside className="sticky top-16 z-20 -mx-4 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur lg:top-24 lg:mx-0 lg:self-start lg:border-0 lg:bg-transparent lg:p-0">
        <div className="hidden text-xs font-semibold uppercase tracking-widest text-muted lg:block">{d.onThisPage}</div>
        <nav className="flex gap-1 overflow-x-auto lg:mt-3 lg:flex-col">
          {DOC_SECTIONS.map((id, i) => (
            <a key={id} href={`#${id}`}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition ${active === id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface hover:text-fg'}`}>
              <span className="mr-2 hidden font-mono text-xs opacity-60 lg:inline">{String(i + 1).padStart(2, '0')}</span>{d.nav[id]}
            </a>
          ))}
        </nav>
      </aside>

      <article className="min-w-0 space-y-16 leading-relaxed text-fg/90">
        <header className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">{d.kicker}</div>
          <h1 className="font-display text-3xl font-extrabold uppercase sm:text-[2.6rem]">{d.title}</h1>
          <p className="max-w-3xl text-muted">{d.lead}</p>
          <div className="flex gap-3 rounded-lg border border-accent/40 bg-accent-soft p-3 text-sm"><span className="text-accent">●</span><span>{d.preview}</span></div>
        </header>

        {/* 1 Overview */}
        <section className="space-y-4">
          <H id="overview" n={1}>{d.nav.overview}</H>
          <p>{d.overview.p1}</p>
          <p className="text-muted">{d.overview.p2}</p>
          <div className="grid gap-3 md:grid-cols-3">
            {d.overview.roles.map((r) => <div key={r.t} className="panel p-4"><div className="font-display text-lg font-bold text-accent">{r.t}</div><p className="mt-1 text-sm text-muted">{r.d}</p></div>)}
          </div>
        </section>

        {/* 2 How it works */}
        <section className="space-y-4">
          <H id="how" n={2}>{d.nav.how}</H>
          <p className="text-muted">{d.how.intro}</p>
          <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
            {d.how.steps.map((s, i) => (
              <div key={s.t} className="contents">
                <div className="panel flex-1 p-4">
                  <div className="font-display text-lg font-bold"><span className="text-accent">0{i + 1}</span> {s.t}</div>
                  <p className="mt-1 text-sm text-muted">{s.d}</p>
                </div>
                {i < d.how.steps.length - 1 && <div className="self-center font-mono text-xl text-accent md:rotate-0 rotate-90" aria-hidden>→</div>}
              </div>
            ))}
          </div>
          <div className="panel p-5">
            <div className="flex flex-col items-center gap-2 text-center text-sm">
              <div className="rounded-md border-2 border-accent px-4 py-2 font-semibold">{d.how.taxLabel} · <span className="font-mono text-accent">{TAX_PCT}%</span></div>
              <div className="h-5 w-px bg-accent/60" />
              <div className="grid w-full max-w-xl grid-cols-[1fr_3fr] gap-2">
                <div className="rounded-md border border-line bg-muted/10 px-3 py-2"><div className="text-xs text-muted">{d.how.flapLabel}</div><div className="font-mono">{FLAP_CUT_PCT}%</div></div>
                <div className="rounded-md border border-accent/50 px-3 py-2"><div className="text-xs text-muted">{d.how.gfLabel}</div><div className="font-mono">{net}%</div></div>
              </div>
              <div className="grid w-full max-w-xl grid-cols-[1fr_3fr] gap-2"><div /><div className="mx-auto h-5 w-px bg-accent/60" /></div>
              <div className="grid w-full max-w-xl grid-cols-[1fr_3fr] gap-2">
                <div />
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md border border-line px-2 py-2"><div className="text-xs text-muted">{d.how.platformLabel}</div><div className="font-mono">{SPLIT.platform}%</div></div>
                  <div className="rounded-md bg-accent px-2 py-2 text-black"><div className="text-xs">{d.how.potLabel}</div><div className="font-mono font-bold">{SPLIT.pot}%</div></div>
                  <div className="rounded-md bg-glow px-2 py-2 text-black"><div className="text-xs">{d.how.buybackLabel}</div><div className="font-mono font-bold">{SPLIT.buyback}%</div></div>
                </div>
              </div>
            </div>
          </div>
          <p className="text-sm text-muted">{d.how.loopNote}</p>
        </section>

        {/* 3 Fees */}
        <section className="space-y-5">
          <H id="fees" n={3}>{d.nav.fees}</H>
          <p>{d.fees.intro}</p>
          <div className="panel space-y-6 p-5">
            <Bar label={d.fees.barWhole} segs={[
              { pct: FLAP_CUT_PCT, label: d.fees.seg.flap, cls: segFlap },
              { pct: (net * SPLIT.platform) / 100, label: d.fees.seg.platform, cls: segPlat },
              { pct: (net * SPLIT.pot) / 100, label: d.fees.seg.pot, cls: segPot },
              { pct: (net * SPLIT.buyback) / 100, label: d.fees.seg.buyback, cls: segBuy },
            ]} />
            <Bar label={d.fees.barVault} segs={[
              { pct: SPLIT.platform, label: d.fees.seg.platform, cls: segPlat },
              { pct: SPLIT.pot, label: d.fees.seg.pot, cls: segPot },
              { pct: SPLIT.buyback, label: d.fees.seg.buyback, cls: segBuy },
            ]} />
            <p className="text-xs text-muted">{d.fees.flapNote} {d.fees.creator}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="panel border-accent/40 p-5">
              <H3>{d.fees.exTitle}</H3>
              <dl className="mt-3 divide-y divide-line text-sm">
                {d.fees.exRows.map(([k, v], i) => (
                  <div key={k} className={`flex justify-between py-1.5 ${i === 3 ? 'font-semibold' : ''}`}><dt className="text-muted">{k}</dt><dd className={`font-mono ${i === 5 ? 'text-accent' : ''}`}>{v}</dd></div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted">{d.fees.exNote}</p>
            </div>
            <div className="space-y-4">
              <div className="panel p-5"><H3>{d.fees.startTitle}</H3><p className="mt-2 text-sm text-muted">{d.fees.startBody}</p></div>
              <div className="panel p-5">
                <H3>{d.fees.freqTitle}</H3>
                <p className="mt-2 text-sm text-muted">{d.fees.freqIntro}</p>
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-widest text-muted"><tr><th className="py-1">{d.fees.freqCols[0]}</th><th className="py-1 text-right">{d.fees.freqCols[1]}</th></tr></thead>
                  <tbody className="divide-y divide-line font-mono">
                    {PACKS.map((p) => <tr key={p.id}><td className="py-1.5">{money(p.usd)}</td><td className="py-1.5 text-right text-accent">≈ {money(Math.round(volumePerPull(p.usd)))}</td></tr>)}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted">{d.fees.freqNote}</p>
              </div>
            </div>
          </div>
        </section>

        {/* 4 Packs */}
        <section className="space-y-5">
          <H id="packs" n={4}>{d.nav.packs}</H>
          <div className="panel p-5"><H3>{d.packs.renaissTitle}</H3><p className="mt-2 text-sm text-muted">{d.packs.renaissBody}</p></div>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-widest text-muted"><tr>{d.packs.cols.map((c) => <th key={c} className="px-4 py-3">{c}</th>)}</tr></thead>
              <tbody className="divide-y divide-line font-mono">
                {PACKS.map((p) => <tr key={p.id}><td className="px-4 py-3 text-glow">{p.id}</td><td className="px-4">{money(p.usd)}</td><td className="px-4">{p.maxWin}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">{d.packs.pricing}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="panel p-5"><H3>{d.packs.gradersTitle}</H3><p className="mt-2 text-sm text-muted">{d.packs.gradersBody}</p>
              <div className="mt-3 flex gap-2">{['PSA', 'CGC', 'BGS'].map((g) => <span key={g} className="rounded border border-line px-2 py-0.5 font-mono text-xs">{g}</span>)}</div></div>
            <div className="panel p-5"><H3>{d.packs.custodyTitle}</H3><p className="mt-2 text-sm text-muted">{d.packs.custodyBody}</p></div>
          </div>
          <div className="panel p-5">
            <H3>{d.packs.sellTitle}</H3>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {d.packs.sellRows.map(([w, r]) => (
                <div key={w} className="rounded-lg border border-line p-3 text-center">
                  <div className="text-xs uppercase tracking-widest text-muted">{d.packs.sellCols[0]} {w}</div>
                  <div className="mt-1 font-display text-2xl font-bold text-accent">{r.match(/\d+%/)?.[0]}</div>
                  <div className="text-xs text-muted">{r}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">{d.packs.sellNote}</p>
          </div>
        </section>

        {/* 5 Strategies */}
        <section className="space-y-4">
          <H id="strategies" n={5}>{d.nav.strategies}</H>
          <p className="text-muted">{d.strategies.intro}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {STRATS.map((s) => (
              <div key={s} className="panel flex flex-col p-5">
                <div className="font-display text-xl font-bold">{STRATEGY_INFO[s].icon} {t(`st_${s}`)}</div>
                <div className="mt-3 text-xs uppercase tracking-widest text-accent">{d.strategies.gets}</div>
                <p className="mt-1 text-sm text-fg/85">{d.strategies.items[s].gets}</p>
                <div className="mt-3 text-xs uppercase tracking-widest text-muted">{d.strategies.best}</div>
                <p className="mt-1 text-sm text-muted">{d.strategies.items[s].best}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 6 Rewards */}
        <section className="space-y-5">
          <H id="rewards" n={6}>{d.nav.rewards}</H>
          <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <div className="panel p-5"><H3>{d.rewards.eligTitle}</H3><p className="mt-2 text-sm text-muted">{d.rewards.eligBody}</p></div>
            <div className="panel p-5"><H3>{d.rewards.exclTitle}</H3><div className="mt-2"><Bullets items={d.rewards.excl} mark="✕" /></div></div>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="panel p-5"><H3>{d.rewards.raffleTitle}</H3><div className="mt-3"><Steps items={d.rewards.raffle} /></div></div>
            <div className="panel p-5"><H3>{d.rewards.divTitle}</H3><div className="mt-3"><Steps items={d.rewards.div} /></div></div>
            <div className="panel border-accent/40 p-5"><H3>{d.rewards.claimTitle}</H3><div className="mt-3"><Steps items={d.rewards.claim} /></div></div>
          </div>
        </section>

        {/* 7 Launch */}
        <section className="space-y-5">
          <H id="launch" n={7}>{d.nav.launch}</H>
          <p className="text-muted">{d.launch.intro}</p>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {d.launch.steps.map((s, i) => (
              <li key={s.t} className="panel p-4"><div className="font-mono text-xs text-accent">STEP {i + 1}</div><div className="mt-1 font-semibold">{s.t}</div><p className="mt-1 text-xs text-muted">{s.d}</p></li>
            ))}
          </ol>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="panel p-5"><H3>{d.launch.lockedTitle}</H3><div className="mt-2"><Bullets items={d.launch.locked} mark="🔒" /></div></div>
            <div className="panel p-5"><H3>{d.launch.vanityTitle}</H3><p className="mt-2 text-sm text-muted">{d.launch.vanityBody}</p><div className="mt-3 font-mono text-xs text-muted">0x…<span className="text-accent">7777</span></div></div>
            <div className="panel p-5"><H3>{d.launch.costTitle}</H3><p className="mt-2 text-sm text-muted">{d.launch.costBody}</p></div>
          </div>
          <a href="/launch" className="inline-block rounded-md border-2 border-accent bg-accent px-4 py-2 font-display font-bold uppercase text-black shadow-[4px_4px_0_0_#D4FF7A]">{lang === 'zh' ? '去发币 →' : 'Go to Launch →'}</a>
        </section>

        {/* 8 FORGE */}
        <section className="space-y-4">
          <H id="forge" n={8}>{d.nav.forge}</H>
          <div className="panel space-y-3 p-5 text-sm">
            <p>{d.forge.p1}</p><p className="text-muted">{d.forge.p2}</p><p className="text-muted">{d.forge.p3}</p>
            <a href="/forge" className="inline-block text-accent hover:underline">{d.forge.link} →</a>
          </div>
        </section>

        {/* 9 Safety */}
        <section className="space-y-5">
          <H id="safety" n={9}>{d.nav.safety}</H>
          <p className="text-muted">{d.safety.intro}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="panel border-success/40 p-5"><H3>{d.safety.onchainTitle}</H3><div className="mt-3"><Bullets items={d.safety.onchain} mark="✓" /></div></div>
            <div className="panel border-danger/40 p-5"><H3>{d.safety.trustedTitle}</H3><div className="mt-3"><Bullets items={d.safety.trusted} mark="!" /></div></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {([[d.safety.adminTitle, d.safety.admin], [d.safety.flapTitle, d.safety.flap], [d.safety.auditTitle, d.safety.audit], [d.safety.previewTitle, d.safety.previewBody]] as const).map(([t, b]) => (
              <div key={t} className="panel p-5"><H3>{t}</H3><p className="mt-2 text-sm text-muted">{b}</p></div>
            ))}
          </div>
        </section>

        {/* 10 Contracts */}
        <section className="space-y-4">
          <H id="contracts" n={10}>{d.nav.contracts}</H>
          <p className="text-sm text-muted">{d.contracts.intro}</p>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-widest text-muted"><tr>{d.contracts.cols.map((c) => <th key={c} className="px-4 py-3">{c}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {addresses.map((a) => (
                  <tr key={a.key}>
                    <td className="px-4 py-3">{d.contracts.rows[a.key]}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {a.address
                        ? <a href={addrUrl(a.address)} target="_blank" rel="noreferrer" className="break-all text-glow hover:underline">{a.address}</a>
                        : <span className="text-muted">{d.contracts.unset}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 11 FAQ */}
        <section className="space-y-4">
          <H id="faq" n={11}>{d.nav.faq}</H>
          <div className="space-y-2">
            {d.faq.map((f) => (
              <details key={f.q} className="panel group p-4 open:border-accent/50">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">{f.q}<span className="text-xl leading-none text-accent transition group-open:rotate-45">+</span></summary>
                <p className="mt-2 text-sm text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 12 Glossary */}
        <section className="space-y-4">
          <H id="glossary" n={12}>{d.nav.glossary}</H>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {d.glossary.map((g) => <div key={g.t} className="border-l-2 border-accent/50 pl-3"><dt className="font-semibold">{g.t}</dt><dd className="text-sm text-muted">{g.d}</dd></div>)}
          </dl>
        </section>

        <aside className="rounded-lg border border-danger/40 bg-danger/5 p-5">
          <div className="font-display text-lg font-bold uppercase tracking-wide text-danger">{d.disclaimer.title}</div>
          <p className="mt-2 text-sm text-muted">{d.disclaimer.body}</p>
        </aside>
      </article>
    </div>
  );
}
