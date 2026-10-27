import { redirect } from "next/navigation";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { DashboardShell } from "@/components/layouts/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  // Option B : carte requise dès l'inscription
  // Bloque si jamais passé par Stripe OU si abonnement ni actif ni en essai
  if (isSubscriptionBlocked(user)) {
    redirect("/abonnement");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
