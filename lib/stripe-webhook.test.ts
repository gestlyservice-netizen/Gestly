import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";

// Recette Stripe simulée : la vérification de signature du webhook utilise le
// VRAI SDK Stripe (secret fictif, aucun appel réseau) ; les lectures d'API
// Stripe (abonnements, sessions Checkout) et la base sont simulées.

const WEBHOOK_SECRET = "whsec_fictif_pour_tests";
const realStripe = new Stripe("sk_test_fictif_aucun_appel");

const mocks = vi.hoisted(() => ({
  stripe: {
    subscriptions: { retrieve: vi.fn(), list: vi.fn() },
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
    customers: { create: vi.fn() },
  },
  prisma: {
    user: { updateMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    relanceSettings: { findMany: vi.fn() },
    facture: { findMany: vi.fn() },
  },
  getCurrentUser: vi.fn(),
  createNotification: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: new Proxy(mocks.stripe, {
    get: (target, prop) => (prop === "webhooks" ? realStripe.webhooks : Reflect.get(target, prop)),
  }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), currentUser: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/lib/notifications", () => ({ createNotification: mocks.createNotification, createNotificationOnce: vi.fn() }));
vi.mock("@/lib/sms/ovh-client", () => ({ createOvhClient: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

import { NextRequest } from "next/server";
import { POST as webhook } from "@/app/api/stripe/webhook/route";
import { POST as createCheckout } from "@/app/api/stripe/create-checkout-session/route";
import { syncCheckoutSession } from "@/lib/stripe-webhook";
import { isSubscriptionBlocked, canStartCheckout } from "@/lib/auth";
import { runRelancesCheck } from "@/lib/relances/engine";

const TRIAL_END = 1_800_000_000; // secondes
const PERIOD_END = 1_800_500_000;

function subscription(id: string, status: Stripe.Subscription.Status, extra: Partial<Stripe.Subscription> = {}) {
  return {
    id, object: "subscription", customer: "cus_1", status,
    cancel_at_period_end: false,
    trial_end: status === "trialing" ? TRIAL_END : null,
    items: { data: [{ current_period_end: PERIOD_END }] },
    ...extra,
  } as unknown as Stripe.Subscription;
}

function signedRequest(event: object, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const header = realStripe.webhooks.generateTestHeaderString({ payload, secret });
  return new NextRequest("http://localhost/api/stripe/webhook", {
    method: "POST", body: payload, headers: { "stripe-signature": header },
  });
}

function event(type: string, object: object) {
  return { id: `evt_${type}`, object: "event", type, data: { object } };
}

const invoice = (subId: string) => ({
  object: "invoice", customer: "cus_1",
  parent: { type: "subscription_details", subscription_details: { subscription: subId } },
});

let savedSecret: string | undefined;
let savedPrice: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
  savedPrice = process.env.STRIPE_PRICE_ID;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_ID = "price_fictif";
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("APPEL RÉSEAU INTERDIT dans les tests");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.prisma.user.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
  if (savedPrice === undefined) delete process.env.STRIPE_PRICE_ID;
  else process.env.STRIPE_PRICE_ID = savedPrice;
  vi.restoreAllMocks();
});

describe("POST /api/stripe/webhook — signature", () => {
  it("sans signature : 400, aucune écriture", async () => {
    const res = await webhook(new NextRequest("http://localhost/api/stripe/webhook", { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
    expect(mocks.prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("signature d'un autre secret : 400, aucune écriture", async () => {
    const res = await webhook(signedRequest(event("customer.subscription.updated", subscription("sub_1", "active")), "whsec_autre"));
    expect(res.status).toBe(400);
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("erreur de traitement : 500 (Stripe réessaiera)", async () => {
    mocks.stripe.subscriptions.retrieve.mockRejectedValue(new Error("Stripe indisponible"));
    const res = await webhook(signedRequest(event("customer.subscription.updated", subscription("sub_1", "active"))));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/stripe/webhook — cycle de vie de l'abonnement", () => {
  it("checkout.session.completed : abonnement en essai adopté (statut, fin d'essai, période)", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(subscription("sub_1", "trialing"));
    const res = await webhook(signedRequest(event("checkout.session.completed", {
      object: "checkout.session", customer: "cus_1", subscription: "sub_1",
    })));
    expect(res.status).toBe(200);
    expect(mocks.prisma.user.updateMany).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_1" },
      data: {
        stripeSubscriptionId: "sub_1",
        subscriptionStatus: "trialing",
        stripeCurrentPeriodEnd: new Date(PERIOD_END * 1000),
        stripeCancelAtPeriodEnd: false,
        trialEndsAt: new Date(TRIAL_END * 1000),
      },
    });
  });

  it("[régression] facture à 0 € payée pendant l'essai : le compte reste « trialing », pas « active »", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(subscription("sub_1", "trialing"));
    await webhook(signedRequest(event("invoice.payment_succeeded", invoice("sub_1"))));
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(mocks.prisma.user.updateMany.mock.calls[0][0].data.subscriptionStatus).toBe("trialing");
  });

  it("[régression] événement en retard : l'état écrit est celui relu chez Stripe, pas l'instantané", async () => {
    // L'événement dit "active" mais l'abonnement a été résilié depuis.
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(subscription("sub_1", "canceled"));
    await webhook(signedRequest(event("customer.subscription.updated", subscription("sub_1", "active"))));
    expect(mocks.prisma.user.updateMany.mock.calls[0][0].data.subscriptionStatus).toBe("canceled");
  });

  it("[régression] un ancien abonnement ne peut pas écraser l'abonnement courant", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(subscription("sub_ancien", "canceled"));
    await webhook(signedRequest(event("customer.subscription.deleted", subscription("sub_ancien", "canceled"))));
    expect(mocks.prisma.user.updateMany.mock.calls[0][0].where).toEqual({
      stripeCustomerId: "cus_1",
      OR: [{ stripeSubscriptionId: null }, { stripeSubscriptionId: "sub_ancien" }],
    });
  });

  it("paiement échoué : statut relu (past_due) et notification à l'artisan", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(subscription("sub_1", "past_due"));
    mocks.prisma.user.findFirst.mockResolvedValue({ id: "user_1" });
    await webhook(signedRequest(event("invoice.payment_failed", invoice("sub_1"))));
    expect(mocks.prisma.user.updateMany.mock.calls[0][0].data.subscriptionStatus).toBe("past_due");
    expect(mocks.createNotification).toHaveBeenCalledWith("user_1", "paiement_echoue", expect.any(String), "/dashboard/parametres/abonnement");
  });

  it("paiement échoué d'un abonnement qui n'est pas le courant : aucune notification", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(subscription("sub_ancien", "past_due"));
    mocks.prisma.user.updateMany.mockResolvedValue({ count: 0 });
    await webhook(signedRequest(event("invoice.payment_failed", invoice("sub_ancien"))));
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });
});

describe("accès selon le statut Stripe", () => {
  const u = (status: string, sub: string | null = "sub_1") => ({ stripeSubscriptionId: sub, subscriptionStatus: status });

  it("seuls active et trialing donnent accès", () => {
    expect(isSubscriptionBlocked(u("active"))).toBe(false);
    expect(isSubscriptionBlocked(u("trialing"))).toBe(false);
    // Avant correction, unpaid / incomplete / paused donnaient accès.
    for (const s of ["past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused", "inconnu"]) {
      expect(isSubscriptionBlocked(u(s))).toBe(true);
    }
    expect(isSubscriptionBlocked(u("trialing", null))).toBe(true); // jamais passé par Stripe
  });

  it("nouveau Checkout seulement sans abonnement en cours", () => {
    expect(canStartCheckout(u("trialing", null))).toBe(true);
    expect(canStartCheckout(u("canceled"))).toBe(true);
    for (const s of ["active", "trialing", "past_due", "unpaid"]) expect(canStartCheckout(u(s))).toBe(false);
  });
});

describe("POST /api/stripe/create-checkout-session", () => {
  const req = () => new NextRequest("http://localhost:3000/api/stripe/create-checkout-session", {
    method: "POST", headers: { host: "localhost:3000", "x-forwarded-proto": "http" },
  });
  const baseUser = {
    id: "user_1", email: "artisan@example.com", companyName: "Artisan Fictif",
    stripeCustomerId: "cus_1", stripeSubscriptionId: null as string | null, subscriptionStatus: "trialing",
  };

  beforeEach(() => {
    mocks.stripe.subscriptions.list.mockResolvedValue({ data: [] });
    mocks.stripe.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
  });

  it("[régression] abonnement actif : 409, aucun second abonnement", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...baseUser, stripeSubscriptionId: "sub_1", subscriptionStatus: "active" });
    const res = await createCheckout(req());
    expect(res.status).toBe(409);
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("premier abonnement : client Stripe créé, essai de 14 jours, retour synchronisé", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...baseUser, stripeCustomerId: null });
    mocks.stripe.customers.create.mockResolvedValue({ id: "cus_new" });
    const res = await createCheckout(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/s" });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({ where: { id: "user_1" }, data: { stripeCustomerId: "cus_new" } });
    const params = mocks.stripe.checkout.sessions.create.mock.calls[0][0];
    expect(params).toMatchObject({ customer: "cus_new", mode: "subscription", subscription_data: { trial_period_days: 14 } });
    expect(params.success_url).toBe("http://localhost:3000/abonnement?session_id={CHECKOUT_SESSION_ID}");
  });

  it("[régression] réabonnement après résiliation : pas de second essai gratuit", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...baseUser, stripeSubscriptionId: "sub_1", subscriptionStatus: "canceled" });
    await createCheckout(req());
    expect(mocks.stripe.checkout.sessions.create.mock.calls[0][0].subscription_data).toBeUndefined();
  });

  it("[régression] webhook pas encore reçu / double clic : l'abonnement en cours est adopté, pas dupliqué", async () => {
    mocks.getCurrentUser.mockResolvedValue(baseUser);
    mocks.stripe.subscriptions.list.mockResolvedValue({ data: [subscription("sub_1", "trialing")] });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(subscription("sub_1", "trialing"));
    const res = await createCheckout(req());
    expect(res.status).toBe(409);
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(mocks.prisma.user.updateMany.mock.calls[0][0].data.stripeSubscriptionId).toBe("sub_1");
  });

  it("erreur Stripe : 500 avec message, jamais d'exception non gérée", async () => {
    mocks.getCurrentUser.mockResolvedValue(baseUser);
    mocks.stripe.checkout.sessions.create.mockRejectedValue(new Error("No such price"));
    const res = await createCheckout(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBeTruthy();
  });
});

describe("syncCheckoutSession (retour de Checkout)", () => {
  it("synchronise la session terminée de ce client", async () => {
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({ customer: "cus_1", subscription: "sub_1", status: "complete" });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(subscription("sub_1", "trialing"));
    expect(await syncCheckoutSession("cus_1", "cs_test_1")).toBe(true);
    expect(mocks.prisma.user.updateMany.mock.calls[0][0].where).toEqual({ stripeCustomerId: "cus_1" });
  });

  it("refuse la session d'un autre client ou non terminée", async () => {
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({ customer: "cus_autre", subscription: "sub_x", status: "complete" });
    expect(await syncCheckoutSession("cus_1", "cs_test_1")).toBe(false);
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({ customer: "cus_1", subscription: null, status: "open" });
    expect(await syncCheckoutSession("cus_1", "cs_test_1")).toBe(false);
    expect(await syncCheckoutSession("cus_1", "pas_une_session")).toBe(false);
    expect(mocks.prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("relances automatiques et abonnement", () => {
  it("[régression] abonnement résilié : aucune relance (ni email ni SMS)", async () => {
    mocks.prisma.relanceSettings.findMany.mockResolvedValue([{ userId: "user_1", enabled: true, canalEmail: true, canalSms: true }]);
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "user_1", stripeSubscriptionId: "sub_1", subscriptionStatus: "canceled" });
    const summary = await runRelancesCheck();
    expect(mocks.prisma.facture.findMany).not.toHaveBeenCalled();
    expect(summary.sent).toBe(0);
  });
});
