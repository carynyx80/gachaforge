'use client';
import { useT } from './LangProvider';
import { Wordmark } from './Logo';

export function Footer() {
  const { t } = useT();
  return (
    <footer className="mt-16 border-t border-line bg-surface/50">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-3 font-display text-lg font-semibold text-glow">{t('footer_tag')}</p>
          <p className="mt-2 max-w-md text-sm text-muted">{t('footer_note')}</p>
        </div>
        <div className="flex flex-col gap-2 text-sm text-muted">
          <a href="/#board" className="hover:text-fg">{t('nav_board')}</a>
          <a href="/launch" className="hover:text-fg">{t('nav_launch')}</a>
          <a href="/forge" className="hover:text-fg">{t('nav_forge')}</a>
        </div>
        <div className="flex flex-col gap-2 text-sm text-muted">
          <a href="/docs" className="hover:text-fg">{t('nav_docs')}</a>
          <a href="/transparency" className="hover:text-fg">{t('nav_transparency')}</a>
          <a href="https://x.com/Gachaforge" target="_blank" rel="noreferrer" className="hover:text-fg">X · @Gachaforge</a>
          <span className="font-mono text-xs">BNB Chain · $FORGE</span>
        </div>
      </div>
      <div className="border-t border-line py-4 text-center font-mono text-xs text-muted">© 2026 GachaForge</div>
    </footer>
  );
}
