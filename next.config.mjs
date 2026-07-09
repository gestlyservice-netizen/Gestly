import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@base-ui/react"],
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  disableLogger: true,
  // Pas de compte Sentry configuré pour l'instant : sans SENTRY_AUTH_TOKEN,
  // l'upload des source maps est désactivé et le build reste inchangé.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
