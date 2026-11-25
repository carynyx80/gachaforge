/**
 * Renaiss draw → our card model.
 *
 * Attribute keys are taken from live public `GET /v2/marketplace/collectibles/{tokenId}` responses
 * (Grader, Grade, Cert Number, Year, Set, Card Number, Character, Language). The OpenAPI spec types draw
 * `attributes` as the same `{key,value}[]`, but we have not seen a real draw payload yet, so every field
 * has fallbacks: grader from the cert number or the slab image path, grade from the collectible name.
 */
import type { Grader } from '../types.js';
import type { RenaissDraw } from './schemas.js';
import type { ProviderCard } from './types.js';

const KNOWN_GRADERS = ['PSA', 'CGC', 'BGS', 'SGC', 'TAG', 'ACE', 'HGA'] as const;

function attr(attrs: RenaissDraw['attributes'], ...keys: string[]): string | undefined {
  if (!attrs) return undefined;
  const want = keys.map((k) => k.toLowerCase().replace(/[^a-z]/g, ''));
  for (const a of attrs) if (want.includes(a.key.toLowerCase().replace(/[^a-z]/g, '')) && a.value.trim()) return a.value.trim();
  return undefined;
}

function graderFrom(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.toUpperCase().match(new RegExp(`(?:^|[^A-Z])(${KNOWN_GRADERS.join('|')})(?=[^A-Z]|\\d|$)`));
  return m?.[1];
}

/** "9 Mint" → "9", "8.5 NM/Mint+" → "8.5", "GEM MT 10" → "10", "BLACK LABEL 10" → "10". */
export function parseGrade(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d{1,2}(?:\.\d)?)/);
  return m?.[1];
}

/**
 * Grader is typed PSA|CGC|BGS in SPEC; other graders (SGC, TAG, ...) pass through verbatim rather than being
 * mislabelled. Empty string when nothing identifies it.
 */
export function mapDraw(d: RenaissDraw, opts: { cardPackId?: string; pulledAtSec?: number } = {}): ProviderCard {
  const cert = attr(d.attributes, 'Cert Number', 'Certification Number', 'Cert');
  const imageGrader = d.frontImageUrl?.match(/graded-cards-renders\/([A-Za-z]+)\d/)?.[1];
  const grader = graderFrom(attr(d.attributes, 'Grader', 'Grading Company', 'Grading')) ?? graderFrom(cert) ?? graderFrom(imageGrader) ?? graderFrom(d.name) ?? '';
  const grade = parseGrade(attr(d.attributes, 'Grade')) ?? (grader ? parseGrade(d.name?.match(new RegExp(`${grader}\\s+([\\d.]+)`))?.[1]) : undefined) ?? '';
  const cents = d.buybackBaseValueInUSD ?? null;
  const lastTier = d.buybackTiers.map((t) => Date.parse(t.expiresAt)).filter(Number.isFinite);
  return {
    tokenId: d.tokenId,
    settlementId: d.settlementId,
    cardPackId: opts.cardPackId,
    name: d.name ?? attr(d.attributes, 'Character', 'Name') ?? `Renaiss #${d.tokenId.slice(0, 8)}`,
    set: attr(d.attributes, 'Set', 'Set Name') ?? '',
    grader: grader as Grader,
    grade,
    image: d.frontImageUrl ?? '',
    valueUsd: cents === null ? 0 : Number(cents) / 100,
    tier: d.tier ?? null,
    type: d.type,
    certNumber: cert,
    releaseTxHash: d.releaseTxHash ?? null,
    releaseAt: lastTier.length ? Math.floor(Math.max(...lastTier) / 1000) : undefined,
  };
}
