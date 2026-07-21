import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/privacy",
  "/mentions-legales",
  "/cgu",
  "/cgv",
  "/remboursement",
  "/contact",
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image(.*)",
  "/print(.*)",
  "/d/(.*)",
  "/abonnement",
  "/api/health",
  "/api/stripe/(.*)",
  "/api/admin/ovh-balance/check",
  "/api/relances/check",
  "/api/public(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
