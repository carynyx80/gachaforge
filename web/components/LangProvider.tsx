'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { dict, type DictKey, type Lang } from '@/lib/i18n';

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: DictKey) => string }>({
  lang: 'en', setLang: () => {}, t: (k) => dict.en[k],
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');
  return <Ctx.Provider value={{ lang, setLang, t: (k) => dict[lang][k] }}>{children}</Ctx.Provider>;
}
export const useT = () => useContext(Ctx);
