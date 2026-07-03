import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DashboardShell } from "@/components/layouts/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const now = new Date();
  const trialExpired = user.trialEndsAt < now;
  const notActive = user.subscriptionStatus !== "active";

  if (trialExpired && notActive) {
    redirect("/abonnement");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
