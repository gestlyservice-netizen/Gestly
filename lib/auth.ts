import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "./prisma";

export async function getCurrentUser() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  let user = await prisma.user.findUnique({ where: { clerkId } });

  if (!user) {
    const clerkUser = await currentUser();
    if (!clerkUser) return null;

    const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
    const companyName = clerkUser.firstName
      ? `${clerkUser.firstName} ${clerkUser.lastName ?? ""}`.trim()
      : email;

    // upsert évite la race condition si deux requêtes arrivent simultanément
    // pour un nouvel utilisateur (findUnique → null → create en double → P2002)
    user = await prisma.user.upsert({
      where: { clerkId },
      create: { clerkId, email, companyName },
      update: {},
    });
  }

  return user;
}
