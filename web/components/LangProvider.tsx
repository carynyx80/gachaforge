'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { dict, type DictKey, type Lang } from '@/lib/i18n';
import { fillEconomics } from '@/lib/economics';

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: DictKey) => string }>({
  lang: 'en', setLang: () => {}, t: (k) => fillEconomics(dict.en[k]),
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');
  return <Ctx.Provider value={{ lang, setLang, t: (k) => fillEconomics(dict[lang][k]) }}>{children}</Ctx.Provider>;
}
export const useT = () => useContext(Ctx);
