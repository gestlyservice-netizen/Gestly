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
