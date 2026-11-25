/**
 * flap.sh metadata upload (docs.flap.sh → Flap IPFS Gateway, "Upload token metadata and image").
 * POST https://funcs.flap.sh/api/upload — GraphQL multipart request: parts `operations`, `map`, `0` (the image).
 * Returns the metadata CID, passed as `meta` to Portal.newTokenV6. CORS allows any origin, so the
 * creator's browser uploads directly (no GachaForge server in the path, no account needed).
 */
export const FLAP_UPLOAD_URL = 'https://funcs.flap.sh/api/upload';
export const FLAP_IPFS_GATEWAY = 'https://flap.mypinata.cloud/ipfs/';

const MUTATION = 'mutation Create($file: Upload!, $meta: MetadataInput!) { create(file: $file, meta: $meta) }';

export interface FlapMetaInput {
  description: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  creator: string;
}

const orNull = (v?: string) => (v && v.trim() ? v.trim() : null);

export async function uploadFlapMetadata(image: File, meta: FlapMetaInput, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append('operations', JSON.stringify({
    query: MUTATION,
    variables: {
      file: null,
      meta: {
        description: meta.description.trim(),
        website: orNull(meta.website),
        twitter: orNull(meta.twitter),
        telegram: orNull(meta.telegram),
        creator: meta.creator,
      },
    },
  }));
  form.append('map', JSON.stringify({ 0: ['variables.file'] }));
  form.append('0', image, image.name || 'image.png');
  const res = await fetch(FLAP_UPLOAD_URL, { method: 'POST', body: form, signal });
  if (!res.ok) throw new Error(`flap.sh upload failed (${res.status})`);
  const j = (await res.json()) as { data?: { create?: string }; errors?: { message?: string }[] };
  const cid = j?.data?.create;
  if (!cid || typeof cid !== 'string') throw new Error(j?.errors?.[0]?.message || 'flap.sh upload returned no CID');
  return cid;
}
