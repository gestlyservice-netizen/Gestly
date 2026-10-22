import { Prisma } from "@prisma/client";

// Base Prisma EN MÉMOIRE pour les tests d'intégration du parcours WhatsApp.
// Reproduit uniquement ce dont le parcours a besoin, avec la sémantique
// Prisma qui compte pour la fiabilité :
//   - contraintes d'unicité du schéma → Prisma.PrismaClientKnownRequestError
//     P2002 (dédoublonnage des messages, des jobs, des envois, des
//     notifications) ;
//   - $transaction interactive avec ANNULATION complète en cas d'erreur ;
//   - updateMany conditionnels (réclamations atomiques) et { increment } ;
//   - include / select / orderBy / take ;
//   - Prisma.DbNull / JsonNull relus comme null ;
//   - objets renvoyés copiés (jamais de référence partagée avec la base).
// Aucune connexion réseau, aucune donnée Supabase.

type Row = Record<string, unknown>;

interface Relation {
  model: string;
  localKey: string; // champ de cette table
  foreignKey: string; // champ de la table cible
  many?: boolean;
}

interface ModelDef {
  defaults: () => Row;
  unique: string[][];
  relations?: Record<string, Relation>;
  updatedAt?: boolean;
}

const MODELS: Record<string, ModelDef> = {
  user: {
    defaults: () => ({ phone: null, siret: null, address: null, logoUrl: null, stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: "trialing", plan: "starter", stripeCancelAtPeriodEnd: false, stripeCurrentPeriodEnd: null }),
    unique: [["clerkId"]],
  },
  client: {
    defaults: () => ({ email: null, phone: null, address: null, preferredContact: "email", whatsappOptOut: false }),
    unique: [],
  },
  devis: {
    defaults: () => ({ status: "brouillon", totalHT: 0, totalTVA: 0, totalTTC: 0, validityDays: 30, notes: null, sentAt: null, signedAt: null, linkExpiresAt: null, linkRevoked: false, signatureName: null, signatureIp: null, signatureUserAgent: null, signatureHash: null }),
    unique: [],
    relations: {
      client: { model: "client", localKey: "clientId", foreignKey: "id" },
      lines: { model: "devisLine", localKey: "id", foreignKey: "devisId", many: true },
    },
  },
  devisLine: { defaults: () => ({ tvaRate: 20 }), unique: [] },
  settings: { defaults: () => ({}), unique: [["userId"]] },
  whatsappConversation: {
    defaults: () => ({ userId: null, state: "idle", pendingDevis: null, optedOut: false, lastCreatedDevisId: null }),
    unique: [],
    updatedAt: true,
    relations: { user: { model: "user", localKey: "userId", foreignKey: "id" } },
  },
  whatsappMessage: {
    defaults: () => ({ externalId: null, durationSeconds: null, mediaId: null, mimeType: null, transcription: null, transcriptionModel: null, transcriptionMs: null, transcriptionStatus: null, extractionStatus: null, extractionResult: null, extractionModel: null }),
    unique: [["externalId"]],
    updatedAt: true,
    relations: { conversation: { model: "whatsappConversation", localKey: "conversationId", foreignKey: "id" } },
  },
  whatsappJob: {
    defaults: () => ({ status: "pending", attempts: 0, lastError: null }),
    unique: [["messageId"]],
    updatedAt: true,
    relations: { message: { model: "whatsappMessage", localKey: "messageId", foreignKey: "id" } },
  },
  whatsappSend: {
    defaults: () => ({ status: "pending", attempts: 0, externalMessageId: null, lastError: null }),
    unique: [["devisId"], ["externalMessageId"]],
    updatedAt: true,
  },
  notification: {
    defaults: () => ({ link: null, read: false, dedupeKey: null }),
    // Index unique PARTIEL réel : (userId, dedupeKey) WHERE dedupeKey IS NOT NULL.
    unique: [["userId", "dedupeKey"]],
  },
  aiUsageEvent: {
    defaults: () => ({ inputTokens: null, outputTokens: null, audioSeconds: null, messageId: null }),
    unique: [],
  },
};

type Store = Record<string, Row[]>;
type FailureRule = { op: string; when: (args: unknown) => boolean; error: Error; remaining: number };

function emptyStore(): Store {
  return Object.fromEntries(Object.keys(MODELS).map((m) => [m, []]));
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number);
  const y = b instanceof Date ? b.getTime() : (b as number);
  return x < y ? -1 : x > y ? 1 : 0;
}

function isOperatorObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v);
}

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as Record<string, unknown>[]).some((c) => matches(row, c))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(cond as Record<string, unknown>[]).every((c) => matches(row, c))) return false;
      continue;
    }
    const value = row[key];
    if (isOperatorObject(cond)) {
      for (const [op, arg] of Object.entries(cond)) {
        switch (op) {
          case "equals": if (!eq(value, arg)) return false; break;
          case "not": if (arg === null ? value === null : eq(value, arg)) return false; break;
          case "in": if (!(arg as unknown[]).some((x) => eq(value, x))) return false; break;
          case "lt": if (value === null || value === undefined || cmp(value, arg) >= 0) return false; break;
          case "lte": if (value === null || value === undefined || cmp(value, arg) > 0) return false; break;
          case "gt": if (value === null || value === undefined || cmp(value, arg) <= 0) return false; break;
          case "gte": if (value === null || value === undefined || cmp(value, arg) < 0) return false; break;
          case "startsWith": if (typeof value !== "string" || !value.startsWith(arg as string)) return false; break;
          default: throw new Error(`fake-prisma : opérateur where non géré "${op}"`);
        }
      }
    } else if (!eq(value, cond)) {
      return false;
    }
  }
  return true;
}

function p2002(model: string, fields: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${model}(${fields.join(",")})`, {
    code: "P2002",
    clientVersion: "fake",
    meta: { target: fields },
  });
}

function p2025(model: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`No ${model} found`, { code: "P2025", clientVersion: "fake" });
}

export class FakePrisma {
  store: Store = emptyStore();
  private lastTime = 0;
  private seq = 0;
  private failures: FailureRule[] = [];
  readonly calls: { op: string; args: unknown }[] = [];
  private readonly delegates: Record<string, Record<string, (args?: Record<string, unknown>) => Promise<unknown>>> = {};

  constructor() {
    for (const model of Object.keys(MODELS)) {
      this.delegates[model] = this.makeDelegate(model);
      Object.defineProperty(this, model, { get: () => this.delegates[model], enumerable: true });
    }
  }

  reset(): void {
    this.store = emptyStore();
    this.failures = [];
    this.calls.length = 0;
  }

  // Horloge strictement croissante (deux écritures n'ont jamais le même
  // horodatage), alignée sur l'heure réelle.
  now(): Date {
    this.lastTime = Math.max(Date.now(), this.lastTime + 1);
    return new Date(this.lastTime);
  }

  // Fait échouer la prochaine (ou les n prochaines) opération(s) correspondante(s).
  failNext(op: string, error: Error, when: (args: unknown) => boolean = () => true, times = 1): void {
    this.failures.push({ op, when, error, remaining: times });
  }

  seed(model: string, data: Row): Row {
    const row = this.buildRow(model, data);
    this.checkUnique(model, row);
    this.store[model].push(row);
    return clone(row);
  }

  rows(model: string): Row[] {
    return clone(this.store[model]);
  }

  async $transaction<T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> {
    const snapshot = clone(this.store);
    try {
      return await fn(this);
    } catch (err) {
      this.store = snapshot; // annulation complète, comme une vraie transaction
      throw err;
    }
  }

  private maybeFail(op: string, args: unknown): void {
    this.calls.push({ op, args });
    const rule = this.failures.find((f) => f.op === op && f.remaining > 0 && f.when(args));
    if (rule) {
      rule.remaining--;
      throw rule.error;
    }
  }

  private buildRow(model: string, data: Row): Row {
    const def = MODELS[model];
    const t = this.now();
    const row: Row = {
      id: `${model}_${++this.seq}`,
      createdAt: t,
      ...(def.updatedAt ? { updatedAt: t } : {}),
      ...def.defaults(),
    };
    for (const [k, v] of Object.entries(data)) {
      if (def.relations?.[k]) continue; // écritures imbriquées traitées à part
      row[k] = normalizeValue(v);
    }
    return row;
  }

  private checkUnique(model: string, row: Row, ignoreId?: unknown): void {
    for (const fields of MODELS[model].unique) {
      if (fields.some((f) => row[f] === null || row[f] === undefined)) continue;
      const clash = this.store[model].some((r) => r.id !== ignoreId && fields.every((f) => eq(r[f], row[f])));
      if (clash) throw p2002(model, fields);
    }
  }

  private applyData(model: string, row: Row, data: Row): Row {
    const next = { ...row };
    for (const [k, v] of Object.entries(data)) {
      if (isOperatorObject(v) && "increment" in v) next[k] = (next[k] as number) + (v.increment as number);
      else next[k] = normalizeValue(v);
    }
    if (MODELS[model].updatedAt && !("updatedAt" in data)) next.updatedAt = this.now();
    return next;
  }

  private shape(model: string, row: Row, args: Record<string, unknown> | undefined): Row {
    let out: Row = clone(row);
    const include = args?.include as Record<string, unknown> | undefined;
    if (include) {
      for (const [rel, spec] of Object.entries(include)) {
        const r = MODELS[model].relations?.[rel];
        if (!r || !spec) continue;
        const sub = typeof spec === "object" ? (spec as Record<string, unknown>) : undefined;
        const targets = this.store[r.model].filter((t) => eq(t[r.foreignKey], row[r.localKey]));
        out[rel] = r.many
          ? targets.map((t) => this.shape(r.model, t, sub))
          : targets[0]
            ? this.shape(r.model, targets[0], sub)
            : null;
      }
    }
    const select = args?.select as Record<string, boolean> | undefined;
    if (select) out = Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, out[k]]));
    return out;
  }

  private sorted(rows: Row[], orderBy: unknown): Row[] {
    if (!orderBy) return rows;
    const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Record<string, "asc" | "desc">[];
    return [...rows].sort((a, b) => {
      for (const s of specs) {
        const [field, dir] = Object.entries(s)[0];
        const c = cmp(a[field], b[field]);
        if (c !== 0) return dir === "desc" ? -c : c;
      }
      return 0;
    });
  }

  private makeDelegate(model: string) {
    const find = (where: Record<string, unknown> | undefined) => this.store[model].filter((r) => matches(r, where));
    return {
      findUnique: async (args: Record<string, unknown> = {}) => {
        this.maybeFail(`${model}.findUnique`, args);
        const row = find(args.where as Row)[0];
        return row ? this.shape(model, row, args) : null;
      },
      findFirst: async (args: Record<string, unknown> = {}) => {
        this.maybeFail(`${model}.findFirst`, args);
        const row = this.sorted(find(args.where as Row), args.orderBy)[0];
        return row ? this.shape(model, row, args) : null;
      },
      findUniqueOrThrow: async (args: Record<string, unknown> = {}) => {
        this.maybeFail(`${model}.findUniqueOrThrow`, args);
        const row = find(args.where as Row)[0];
        if (!row) throw p2025(model);
        return this.shape(model, row, args);
      },
      findMany: async (args: Record<string, unknown> = {}) => {
        this.maybeFail(`${model}.findMany`, args);
        let rows = this.sorted(find(args.where as Row), args.orderBy);
        if (typeof args.take === "number") rows = rows.slice(0, args.take);
        return rows.map((r) => this.shape(model, r, args));
      },
      count: async (args: Record<string, unknown> = {}) => {
        this.maybeFail(`${model}.count`, args);
        return find(args.where as Row).length;
      },
      create: async (args: Record<string, unknown> = {}) => {
        this.maybeFail(`${model}.create`, args);
        const data = args.data as Row;
        const row = this.buildRow(model, data);
        this.checkUnique(model, row);
        this.store[model].push(row);
        // Écritures imbriquées (ex. Devis.lines.create).
        for (const [rel, r] of Object.entries(MODELS[model].relations ?? {})) {
          const nested = data[rel] as { create?: Row | Row[] } | undefined;
          if (!nested?.create) continue;
          for (const child of Array.isArray(nested.create) ? nested.create : [nested.create]) {
            const childRow = this.buildRow(r.model, { ...child, [r.foreignKey]: row[r.localKey] });
            this.store[r.model].push(childRow);
          }
        }
        return this.shape(model, row, args);
      },
      update: async (args: Record<string, unknown> = {}) => {
        this.maybeFail(`${model}.update`, args);
        const idx = this.store[model].findIndex((r) => matches(r, args.where as Row));
        if (idx < 0) throw p2025(model);
        const next = this.applyData(model, this.store[model][idx], args.data as Row);
        this.checkUnique(model, next, next.id);
        this.store[model][idx] = next;
        return this.shape(model, next, args);
      },
      updateMany: async (args: Record<string, unknown> = {}) => {
        this.maybeFail(`${model}.updateMany`, args);
        let count = 0;
        this.store[model] = this.store[model].map((r) => {
          if (!matches(r, args.where as Row)) return r;
          count++;
          return this.applyData(model, r, args.data as Row);
        });
        return { count };
      },
    };
  }
}

function normalizeValue(v: unknown): unknown {
  // Prisma relit un champ JSON écrit avec DbNull/JsonNull comme null.
  if (v === Prisma.DbNull || v === Prisma.JsonNull) return null;
  // Copie à l'écriture : une mutation ultérieure de l'objet par l'appelant
  // ne doit jamais modifier la "base".
  return v !== null && typeof v === "object" ? clone(v) : v;
}

// Instance unique partagée par vi.mock("@/lib/prisma") et les tests.
export const fakePrisma = new FakePrisma();
