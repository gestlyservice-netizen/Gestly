import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ClerkProvider } from "@clerk/nextjs";
import { getPublicUrl } from "@/lib/url";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const dynamic = "force-dynamic";

const title = "Gestly — Devis et factures pour artisans et indépendants";
const description =
  "Gestly est le logiciel simple pour créer vos devis et factures, gérer vos clients et suivre vos paiements. Essai gratuit 14 jours.";

export const metadata: Metadata = {
  metadataBase: new URL(getPublicUrl()),
  title: { default: title, template: "%s — Gestly" },
  description,
  keywords: ["devis", "factures", "artisan", "indépendant", "logiciel de facturation", "CRM artisan"],
  authors: [{ name: "DIGITEO" }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "/",
    siteName: "Gestly",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="fr" className={cn(geistSans.variable, geistMono.variable)}>
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
