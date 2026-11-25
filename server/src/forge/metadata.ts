/**
 * flap.sh token metadata.
 * Source: the `meta` string of the Portal `TokenCreated` event (getTokenV8Safe has no meta field).
 * It is usually a bare IPFS CID (from funcs.flap.sh/api/upload), sometimes `ipfs://CID` or a full
 * `https://<gateway>/ipfs/CID` URL. We always fetch through flap's own Pinata gateway
 * (https://flap.mypinata.cloud/ipfs/<CID>, override FORGE_IPFS_GATEWAY) because public gateways
 * (ipfs.io) rate-limit. JSON shape: { name, symbol, description, image (CID), website, twitter, telegram, ... }.
 */
export interface FlapMetadata {
  image?: string;
  description?: string;
  links?: { website?: string; x?: string; telegram?: string };
}

const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/;

/** Extracts `CID[/path]` from a CID, ipfs:// URI or gateway URL; null if it isn't IPFS. */
export function parseIpfsPath(ref: string | undefined | null): string | null {
  const s = (ref ?? '').trim();
  if (!s) return null;
  if (s.startsWith('ipfs://')) return s.slice(7).replace(/^ipfs\//, '') || null;
  const m = s.match(/\/ipfs\/([^?#]+)/);
  if (m) return m[1];
  return CID_RE.test(s.split('/')[0]) ? s : null;
}

/** Image/link value → absolute URL (IPFS refs go through the gateway; http(s) kept as is). */
export function resolveAsset(ref: string | undefined | null, gateway: string): string | undefined {
  const s = (ref ?? '').trim();
  if (!s) return undefined;
  const p = parseIpfsPath(s);
  if (p) return gateway + p;
  return /^https?:\/\//.test(s) ? s : undefined;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const url = (v: unknown, prefix?: string) => {
  const s = str(v);
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (prefix) return prefix + s.replace(/^@/, '');
  return `https://${s}`;
};

export function normalizeMetadata(json: unknown, gateway: string): FlapMetadata {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const links = { website: url(j.website), x: url(j.twitter ?? j.x, 'https://x.com/'), telegram: url(j.telegram, 'https://t.me/') };
  const clean = Object.fromEntries(Object.entries(links).filter(([, v]) => v)) as FlapMetadata['links'];
  return {
    image: resolveAsset(str(j.image), gateway),
    description: str(j.description),
    ...(clean && Object.keys(clean).length ? { links: clean } : {}),
  };
}

export async function fetchFlapMetadata(meta: string, gateway: string, fetchFn: typeof fetch = fetch, timeoutMs = 10_000): Promise<FlapMetadata | null> {
  const path = parseIpfsPath(meta);
  const target = path ? gateway + path : /^https?:\/\//.test(meta) ? meta : null;
  if (!target) return null;
  const res = await fetchFn(target, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`metadata ${res.status} from ${target}`);
  return normalizeMetadata(await res.json(), gateway);
}
