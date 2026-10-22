// Structure persistée dans WhatsappConversation.pendingDevis (Json) et toute
// la logique de fusion multi-tours. Aucune dépendance IA ici : ce module est
// du code métier déterministe pur, testable sans mock ni réseau.
//
// Trois catégories de source pour chaque champ, comme demandé :
// - "artisan" : donnée explicitement dite par l'artisan dans la conversation
// - "gestly"  : donnée déduite de façon fiable côté Gestly (client existant
//               trouvé sans ambiguïté, taux de TVA par défaut du compte,
//               calcul arithmétique déterministe comme quantité × prix)
// - "manquant": absente, nécessite une clarification avant de pouvoir créer
//               le devis. Jamais remplie par une supposition de l'IA.
export type FieldSource = "artisan" | "gestly" | "manquant";

export interface SourcedField<T> {
  value: T | null;
  source: FieldSource;
}

function missingField<T>(): SourcedField<T> {
  return { value: null, source: "manquant" };
}

function artisanField<T>(value: T): SourcedField<T> {
  return { value, source: "artisan" };
}

function gestlyField<T>(value: T): SourcedField<T> {
  return { value, source: "gestly" };
}

export interface PendingDevisLine {
  description: string;
  quantite: SourcedField<number>;
  unite: SourcedField<string>;
  prixUnitaire: SourcedField<number>;
  montant: SourcedField<number>;
  tva: SourcedField<number>;
}

export interface ClientCandidate {
  id: string;
  name: string;
  phone: string | null;
}

export interface PendingDevisClient {
  nomMentionne: string | null;
  telephone: SourcedField<string>;
  email: SourcedField<string>;
  adresse: SourcedField<string>;
  matchedClientId: string | null;
  matchStatus: "not_searched" | "no_match" | "unique_match" | "ambiguous";
  ambiguousCandidates: ClientCandidate[];
}

export type PendingDevisState = "collecting" | "awaiting_creation_confirmation";

export interface PendingDevis {
  version: 1;
  objet: SourcedField<string>;
  descriptionTravaux: SourcedField<string>;
  client: PendingDevisClient;
  lignes: PendingDevisLine[];
  notes: SourcedField<string>;
  ambiguitesOuvertes: string[];
  state: PendingDevisState;
  lastUpdatedAt: string;
  // Identifiant stable de CE brouillon (régénéré à chaque annulation/reprise
  // à zéro) — sert uniquement de clé de dédoublonnage pour l'escalade
  // humaine (étape 8), jamais utilisé pour une décision métier.
  draftId: string;
  // Nombre de tours consécutifs sans progression (hors_sujet/incomprehensible)
  // depuis la dernière info utile — cf. lib/whatsapp/conversation-turn.ts.
  stuckTurns: number;
  // Une fois vrai, une notification d'escalade a déjà été créée pour ce
  // brouillon — ne redemande plus de clarification tant qu'aucune info
  // nouvelle n'a fait progresser le brouillon (cf. applyStuckTracking).
  escalated: boolean;
}

function newDraftId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `draft_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function emptyPendingDevis(now: Date = new Date()): PendingDevis {
  return {
    version: 1,
    objet: missingField(),
    descriptionTravaux: missingField(),
    client: {
      nomMentionne: null,
      telephone: missingField(),
      email: missingField(),
      adresse: missingField(),
      matchedClientId: null,
      matchStatus: "not_searched",
      ambiguousCandidates: [],
    },
    lignes: [],
    notes: missingField(),
    ambiguitesOuvertes: [],
    state: "collecting",
    lastUpdatedAt: now.toISOString(),
    draftId: newDraftId(),
    stuckTurns: 0,
    escalated: false,
  };
}

// Suivi de blocage conversationnel (étape 8, mécanisme 4 — escalade) :
// incrémente stuckTurns sur un message qui n'apporte aucune information
// utile (hors_sujet/incomprehensible), le remet à zéro dès qu'un message
// "devis" progresse réellement le brouillon (même partiellement — c'est un
// engagement sur le sujet, pas un blocage). `escalated` reste vrai tant que
// le blocage n'a pas été résolu par une vraie progression, pour ne jamais
// redemander de clarification ni ré-appeler l'IA de façon perçue comme
// bloquante une fois l'artisan signalé à Gestly.
export function applyStuckTracking(current: PendingDevis, raw: RawExtraction, maxStuckTurns: number): PendingDevis {
  if (raw.intent === "devis" && !raw.plusieursDevisDetectes) {
    return { ...current, stuckTurns: 0, escalated: false };
  }
  const stuck = raw.intent === "hors_sujet" || raw.intent === "incomprehensible";
  const stuckTurns = stuck ? current.stuckTurns + 1 : current.stuckTurns;
  return {
    ...current,
    stuckTurns,
    escalated: current.escalated || stuckTurns >= maxStuckTurns,
  };
}

// ── Fusion ────────────────────────────────────────────────────────────────
// Règle générale : un champ mentionné dans le nouveau message REMPLACE
// l'ancienne valeur (que ce soit pour compléter un champ vide ou corriger
// une valeur déjà connue — les deux cas sont la même opération du point de
// vue de la fusion). Un champ non mentionné (null côté extraction) laisse
// l'ancienne valeur inchangée. Les lignes se distinguent par ligneCibleIndex
// (index dans les lignes déjà connues) : présent = modification d'une ligne
// existante, absent = nouvelle ligne.
export interface RawExtractedLine {
  ligneCibleIndex: number | null;
  description: string | null;
  quantite: number | null;
  unite: string | null;
  prixUnitaire: number | null;
  montant: number | null;
  tva: number | null;
}

export interface RawExtraction {
  intent: "devis" | "hors_sujet" | "annulation" | "confirmation" | "incomprehensible";
  reponseConfirmation: "oui" | "non" | "ambigu" | null;
  client: {
    nom: string | null;
    telephone: string | null;
    email: string | null;
    adresse: string | null;
  };
  objet: string | null;
  descriptionTravaux: string | null;
  lignes: RawExtractedLine[];
  montantMentionne: { valeur: number | null; typeExplicite: "HT" | "TTC" | null } | null;
  notes: string | null;
  plusieursDevisDetectes: boolean;
  ambiguites: string[];
}

// DETTE TECHNIQUE (trouvée en Phase 2 de la validation pré-production,
// 2026-09, appel OpenAI réel) : toute valeur non nulle renvoyée par
// l'extraction est marquée source="artisan", y compris quand le modèle l'a
// recopiée du brouillon déjà fourni en contexte (cf. buildPrompt dans
// extraction.ts, qui inclut les lignes déjà connues) plutôt que réellement
// redite dans le message courant. Observé concrètement sur un tour de
// correction de prix : le modèle a réinclus une TVA déjà connue du contexte
// sans que l'artisan ne la répète, et mergeSourcedField l'a quand même
// étiquetée "artisan". La valeur numérique restait correcte dans ce cas
// (imprécision de provenance, pas une donnée fausse), mais le risque
// existe : si le contexte contenait une valeur erronée, un simple echo du
// modèle la ferait passer pour une confirmation explicite de l'artisan.
// Piste de correction : soit renforcer le prompt système pour interdire
// explicitement de recopier un champ non redit, soit comparer la valeur
// renvoyée à celle déjà connue dans currentPendingDevis pour distinguer un
// echo d'une vraie nouvelle information avant d'assigner la source. Non
// bloquant pour la V1 (le plus fréquent est une valeur déjà correcte
// recopiée), mais à traiter avant de faire confiance à `source` pour une
// décision produit sensible (ex. audit, contestation d'un devis).
function mergeSourcedField<T>(current: SourcedField<T>, newValue: T | null): SourcedField<T> {
  if (newValue === null || newValue === undefined) return current;
  return artisanField(newValue);
}

function mergeLine(existing: PendingDevisLine | undefined, raw: RawExtractedLine, defaultTvaRate: number): PendingDevisLine {
  const base: PendingDevisLine =
    existing ?? {
      description: raw.description ?? "",
      quantite: missingField(),
      unite: missingField(),
      prixUnitaire: missingField(),
      montant: missingField(),
      tva: missingField(),
    };

  const merged: PendingDevisLine = {
    description: raw.description ?? base.description,
    quantite: mergeSourcedField(base.quantite, raw.quantite),
    unite: mergeSourcedField(base.unite, raw.unite),
    prixUnitaire: mergeSourcedField(base.prixUnitaire, raw.prixUnitaire),
    montant: mergeSourcedField(base.montant, raw.montant),
    tva: mergeSourcedField(base.tva, raw.tva),
  };

  // Calcul déterministe autorisé : quantité × prix unitaire, uniquement si
  // les deux sont explicitement connus et qu'aucun montant n'a été donné
  // directement pour cette ligne. Jamais l'inverse (on ne déduit jamais un
  // prix unitaire à partir d'un montant total — ce serait une supposition).
  if (
    merged.montant.value === null &&
    merged.quantite.value !== null &&
    merged.prixUnitaire.value !== null
  ) {
    merged.montant = gestlyField(round2(merged.quantite.value * merged.prixUnitaire.value));
  }

  // TVA par défaut du compte si jamais précisée par l'artisan pour cette
  // ligne — appliquée seulement si la ligne a par ailleurs un prix connu
  // (pas de sens à taxer une ligne qu'on ne sait même pas chiffrer).
  if (merged.tva.value === null && (merged.prixUnitaire.value !== null || merged.montant.value !== null)) {
    merged.tva = gestlyField(defaultTvaRate);
  }

  return merged;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function mergePendingDevis(
  current: PendingDevis,
  raw: RawExtraction,
  defaultTvaRate: number,
  now: Date = new Date()
): PendingDevis {
  const next: PendingDevis = {
    ...current,
    objet: mergeSourcedField(current.objet, raw.objet),
    descriptionTravaux: mergeSourcedField(current.descriptionTravaux, raw.descriptionTravaux),
    notes: mergeSourcedField(current.notes, raw.notes),
    client: { ...current.client },
    lignes: [...current.lignes],
    ambiguitesOuvertes: [],
    lastUpdatedAt: now.toISOString(),
  };

  if (raw.client.nom !== null) {
    next.client.nomMentionne = raw.client.nom;
    // Un nouveau nom mentionné invalide toute résolution précédente : il
    // faudra rechercher à nouveau (fait par l'appelant, pas ce module).
    next.client.matchedClientId = null;
    next.client.matchStatus = "not_searched";
    next.client.ambiguousCandidates = [];
  }
  next.client.telephone = mergeSourcedField(next.client.telephone, raw.client.telephone);
  next.client.email = mergeSourcedField(next.client.email, raw.client.email);
  next.client.adresse = mergeSourcedField(next.client.adresse, raw.client.adresse);

  for (const rawLine of raw.lignes) {
    if (rawLine.ligneCibleIndex !== null && next.lignes[rawLine.ligneCibleIndex]) {
      next.lignes[rawLine.ligneCibleIndex] = mergeLine(next.lignes[rawLine.ligneCibleIndex], rawLine, defaultTvaRate);
    } else {
      next.lignes.push(mergeLine(undefined, rawLine, defaultTvaRate));
    }
  }

  // Ambiguïté globale HT/TTC : jamais tranchée automatiquement.
  if (raw.montantMentionne && raw.montantMentionne.valeur !== null && raw.montantMentionne.typeExplicite === null) {
    next.ambiguitesOuvertes.push(
      `Le montant de ${raw.montantMentionne.valeur} € est-il HT ou TTC, et à quelle prestation correspond-il ?`
    );
  }
  for (const a of raw.ambiguites) next.ambiguitesOuvertes.push(a);

  return next;
}

// ── Complétude ────────────────────────────────────────────────────────────
export function computeMissingRequirements(p: PendingDevis): string[] {
  const missing: string[] = [];

  if (!p.client.nomMentionne) missing.push("le nom du client");
  if (p.client.matchStatus === "ambiguous") missing.push("quel client exactement (plusieurs correspondances)");

  if (!p.objet.value && !p.descriptionTravaux.value) missing.push("l'objet ou la description des travaux");

  if (p.lignes.length === 0) {
    missing.push("au moins une prestation avec son prix");
  } else {
    for (let i = 0; i < p.lignes.length; i++) {
      const ligne = p.lignes[i];
      const hasPrice = ligne.montant.value !== null || ligne.prixUnitaire.value !== null;
      if (!hasPrice) missing.push(`le prix de la prestation "${ligne.description || `#${i + 1}`}"`);
    }
  }

  return missing;
}

export function computeNextState(p: PendingDevis): PendingDevisState {
  const missing = computeMissingRequirements(p);
  if (missing.length === 0 && p.ambiguitesOuvertes.length === 0) return "awaiting_creation_confirmation";
  return "collecting";
}

export type ClientResolutionResult = Pick<
  PendingDevisClient,
  "matchedClientId" | "matchStatus" | "ambiguousCandidates"
>;

// Orchestration complète de la fusion, pour un tour de conversation :
// applique la bonne branche selon l'intention détectée. La résolution
// client est injectée (resolveClientFn) plutôt qu'appelée en dur, ce qui
// rend cette fonction — donc toute la logique de décision, hors accès
// disque — testable sans base de données.
export async function applyExtractionToPendingDevis(
  current: PendingDevis,
  raw: RawExtraction,
  defaultTvaRate: number,
  resolveClientFn: (name: string | null, phone: string | null) => Promise<ClientResolutionResult>,
  now: Date = new Date()
): Promise<PendingDevis> {
  if (raw.intent === "annulation") {
    return emptyPendingDevis(now);
  }

  if (raw.intent === "devis" && !raw.plusieursDevisDetectes) {
    const merged = mergePendingDevis(current, raw, defaultTvaRate, now);

    if (merged.client.nomMentionne && merged.client.matchStatus === "not_searched") {
      const resolution = await resolveClientFn(merged.client.nomMentionne, merged.client.telephone.value);
      merged.client.matchedClientId = resolution.matchedClientId;
      merged.client.matchStatus = resolution.matchStatus;
      merged.client.ambiguousCandidates = resolution.ambiguousCandidates;
    }

    merged.state = computeNextState(merged);
    return merged;
  }

  // hors_sujet / incomprehensible / confirmation / plusieurs devis détectés :
  // le brouillon en cours n'est jamais modifié par ces messages.
  return current;
}
