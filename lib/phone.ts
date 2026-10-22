// Normalisation unique des numéros de téléphone au format E.164, réutilisée
// par tous les canaux (SMS OVH, envoi WhatsApp, agent IA WhatsApp).
// Remplace les deux implémentations précédemment dupliquées dans
// lib/sms/ovh-provider.ts et app/api/devis/[id]/whatsapp/route.ts.
export function normalizePhoneE164(raw: string, defaultCountryCode = "33"): string {
  let n = raw.replace(/[\s\-.()]/g, "");
  if (n.startsWith("00")) n = "+" + n.slice(2);
  else if (n.startsWith("0")) n = `+${defaultCountryCode}` + n.slice(1);
  else if (!n.startsWith("+")) n = "+" + n;
  return n;
}
