import { z } from "zod";

// Schémas volontairement permissifs (passthrough) : un webhook Meta peut
// évoluer avec de nouveaux champs sans que ça ne doive faire échouer le
// traitement. Chaque message est validé individuellement (pas le tableau
// entier) pour qu'un message malformé n'entraîne pas le rejet des autres
// messages du même payload.
export const MetaMessage = z
  .object({
    id: z.string(),
    from: z.string(),
    type: z.string(),
    timestamp: z.string().optional(),
    text: z.object({ body: z.string() }).optional(),
    audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  })
  .passthrough();

export type MetaMessageT = z.infer<typeof MetaMessage>;

const MetaValue = z
  .object({
    metadata: z
      .object({
        display_phone_number: z.string().optional(),
        phone_number_id: z.string().optional(),
      })
      .optional(),
    messages: z.array(z.unknown()).optional(),
    statuses: z.array(z.unknown()).optional(),
  })
  .passthrough();

const MetaChange = z
  .object({
    field: z.string().optional(),
    value: MetaValue,
  })
  .passthrough();

const MetaEntry = z
  .object({
    id: z.string().optional(),
    changes: z.array(MetaChange).default([]),
  })
  .passthrough();

export const MetaWebhookPayload = z
  .object({
    object: z.string().optional(),
    entry: z.array(MetaEntry).default([]),
  })
  .passthrough();
