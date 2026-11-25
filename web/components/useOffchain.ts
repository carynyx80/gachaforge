'use client';
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from './LangProvider';
import { fillEconomics } from '@/lib/economics';
import { offDict, type OffKey } from '@/lib/offchain-i18n';
import { getHealth } from '@/lib/api';
import type { Health } from '@/lib/types';

/** Off-chain-mode copy; extra {placeholders} come from `vars`. */
export function useOffT() {
  const { lang } = useT();
  return useCallback((k: OffKey, vars?: Record<string, string | number>) => {
    // Caller vars win over the global economics placeholders (e.g. a machine's own {pot} vs the $FORGE {pot}).
    let s: string = offDict[lang][k];
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, v: string) => (v in vars ? String(vars[v]) : m));
    return fillEconomics(s);
  }, [lang]);
}

/** Shared /api/health poll. `data` is undefined until the first answer. */
export function useHealth() {
  return useQuery<Health>({ queryKey: ['health'], queryFn: getHealth, refetchInterval: 60_000, staleTime: 30_000 });
}
