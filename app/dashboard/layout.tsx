import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DashboardShell } from "@/components/layouts/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  // Option B : carte requise dès l'inscription
  // Bloque si jamais passé par Stripe OU si abonnement suspendu/impayé
  const noPaymentMethod = !user.stripeSubscriptionId;
  const suspended =
    user.subscriptionStatus === "canceled" || user.subscriptionStatus === "past_due";

  if (noPaymentMethod || suspended) {
    redirect("/abonnement");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
