// Limitation de débit PARTAGÉE entre toutes les instances Vercel, dans la
// base PostgreSQL existante (table "RateLimitBucket", migration
// prisma/manual-migrations/20261109_rate_limit_bucket_up.sql).
//
// Chaque appel est UNE requête atomique : INSERT … ON CONFLICT DO UPDATE …
// RETURNING. PostgreSQL verrouille la ligne de la clé pendant la mise à jour :
// N requêtes simultanées obtiennent N compteurs distincts (1, 2, …, N), donc
// jamais plus de `limit` passages par fenêtre, même réparties sur plusieurs
// instances. L'horloge est celle de la base (now()), commune à toutes.
//
// Tant que la table n'existe pas (migration non appliquée), ou si la base ne
// répond pas, repli sur la limite en mémoire (lib/rate-limit.ts), signalé une
// fois dans les journaux et Sentry. Présence de la table vérifiée par
// to_regclass, revérifiée toutes les 5 minutes : la limite partagée s'active
// sans redéploiement après application de la migration.
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";

export type RateLimitSource = "db" | "memory";

const TABLE_CHECK_MS = 5 * 60_000;
let tableState: { present: boolean; checkedAt: number } | null = null;
let fallbackReported = false;

/** Tests uniquement : oublie l'état mémorisé de la table et des signalements. */
export function resetRateLimitDbState(): void {
  tableState = null;
  fallbackReported = false;
}

async function tablePresent(): Promise<boolean> {
  const now = Date.now();
  if (tableState && now - tableState.checkedAt < TABLE_CHECK_MS) return tableState.present;
  const rows = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('public."RateLimitBucket"') IS NOT NULL AS present`;
  tableState = { present: rows[0]?.present === true, checkedAt: now };
  return tableState.present;
}

function reportFallback(reason: string, err?: unknown): void {
  if (fallbackReported) return;
  fallbackReported = true;
  const message = `[rate-limit] limite en mémoire (non partagée entre instances) : ${reason}`;
  if (err) console.error(message, err);
  else console.error(message);
  Sentry.captureMessage(message, "warning");
}

/**
 * Compte un passage pour `key` et indique s'il dépasse `limit` dans la
 * fenêtre `windowMs` (même sémantique que isRateLimited : les `limit` premiers
 * passent, les suivants sont refusés jusqu'à la fin de la fenêtre).
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ limited: boolean; count: number | null; source: RateLimitSource }> {
  try {
    if (await tablePresent()) {
      const rows = await prisma.$queryRaw<{ count: number }[]>`
        INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "expiresAt")
        VALUES (
          ${key}, 1,
          (now() AT TIME ZONE 'UTC'),
          (now() AT TIME ZONE 'UTC') + (${Math.round(windowMs)}::int * interval '1 millisecond')
        )
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "RateLimitBucket"."expiresAt" <= (now() AT TIME ZONE 'UTC')
                         THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
          "windowStart" = CASE WHEN "RateLimitBucket"."expiresAt" <= (now() AT TIME ZONE 'UTC')
                               THEN EXCLUDED."windowStart" ELSE "RateLimitBucket"."windowStart" END,
          "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= (now() AT TIME ZONE 'UTC')
                             THEN EXCLUDED."expiresAt" ELSE "RateLimitBucket"."expiresAt" END
        RETURNING "count"`;
      const count = Number(rows[0]?.count);
      if (!Number.isFinite(count)) throw new Error("compteur absent de la réponse");
      return { limited: count > limit, count, source: "db" };
    }
    reportFallback("table RateLimitBucket absente (migration 20261109 non appliquée)");
  } catch (err) {
    // Table supprimée entre deux vérifications : revérifier au prochain appel.
    tableState = null;
    reportFallback("base indisponible ou erreur SQL", err);
  }
  return { limited: isRateLimited(key, limit, windowMs), count: null, source: "memory" };
}

/** Supprime les compteurs expirés depuis plus d'un jour ; 0 si la table est absente. */
export async function purgeExpiredRateLimits(): Promise<number> {
  if (!(await tablePresent())) return 0;
  return prisma.$executeRaw`
    DELETE FROM "RateLimitBucket" WHERE "expiresAt" < (now() AT TIME ZONE 'UTC') - interval '1 day'`;
}
