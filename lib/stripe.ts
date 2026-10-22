import Stripe from "stripe";

// Instanciation paresseuse : STRIPE_SECRET_KEY n'est lu qu'au premier appel
// réel, jamais au chargement du module. Trouvé lors d'un déploiement Vercel
// Preview (2026-09) : l'ancienne instanciation au niveau module faisait
// planter "Collecting page data" pour TOUTES les routes de l'app dès que
// STRIPE_SECRET_KEY manquait dans l'environnement cible (Preview n'a pas
// forcément les mêmes variables que Production) — un problème de
// configuration Stripe ne devrait jamais empêcher de builder des routes qui
// n'ont rien à voir avec Stripe.
let cachedClient: Stripe | undefined;

function getStripeClient(): Stripe {
  if (!cachedClient) {
    cachedClient = new Stripe(process.env.STRIPE_SECRET_KEY!.trim());
  }
  return cachedClient;
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getStripeClient();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
