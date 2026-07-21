// Rate limiting en mémoire, par instance de fonction serverless.
// Limite : ne survit pas à un cold start et n'est pas partagé entre
// plusieurs instances concurrentes (pas de Redis/KV configuré). C'est une
// mitigation raisonnable pour un endpoint à coût variable (appel IA), pas
// une garantie distribuée — à durcir avec Vercel KV/Upstash si le volume
// le justifie.
const buckets = new Map<string, { count: number; windowStart: number }>();

export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }

  bucket.count++;
  return bucket.count > limit;
}
