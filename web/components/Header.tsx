'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useT } from './LangProvider';
import { Wordmark } from './Logo';
import type { DictKey } from '@/lib/i18n';

const NAV: { href: string; k: DictKey }[] = [
  { href: '/#board', k: 'nav_board' },
  { href: '/launch', k: 'nav_launch' },
  { href: '/#pulls', k: 'nav_pulls' },
  { href: '/buyback-burn', k: 'nav_burn' },
  { href: '/docs', k: 'nav_docs' },
];

export function Header() {
  const { t, lang, setLang } = useT();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
        <Link href="/" aria-label="GachaForge home"><Wordmark /></Link>
        <nav className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link key={n.k} href={n.href} className="rounded-md px-3 py-2 font-display text-sm font-semibold uppercase tracking-wider text-muted transition hover:bg-surface hover:text-fg">
              {t(n.k)}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-line text-xs font-semibold">
            {(['en', 'zh'] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)} className={`px-2.5 py-1.5 transition ${lang === l ? 'bg-accent text-black' : 'text-muted hover:text-fg'}`}>
                {l === 'en' ? 'EN' : '中文'}
              </button>
            ))}
          </div>
          <a href="https://x.com/" target="_blank" rel="noreferrer" aria-label="X" className="hidden h-8 w-8 place-items-center rounded-md border border-line text-muted transition hover:text-fg sm:grid">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" /></svg>
          </a>
          <button className="btn-chunky px-4 py-2 text-sm" onClick={() => alert('Wallet connect coming soon')}>{t('connect')}</button>
          <button className="grid h-9 w-9 place-items-center rounded-md border border-line lg:hidden" aria-label="Menu" onClick={() => setOpen(!open)}>
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-line px-4 py-2 lg:hidden">
          {NAV.map((n) => (
            <Link key={n.k} href={n.href} onClick={() => setOpen(false)} className="block py-2 font-display font-semibold uppercase tracking-wider text-muted hover:text-fg">{t(n.k)}</Link>
          ))}
        </nav>
      )}
    </header>
  );
}
