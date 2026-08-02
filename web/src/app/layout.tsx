import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import { ELECTRON_RAM, links, RAM_CORE, RAM_FOOTPRINT, SITE_URL } from "@/lib/site";
import "./globals.css";

/**
 * Absolute origin the social cards and canonical URLs resolve against. Defaults
 * to the Cloudflare Pages subdomain; override `NEXT_PUBLIC_SITE_URL` at build
 * time once a custom domain is live (the deploy workflow sets it).
 */
const siteUrl = SITE_URL;

// Interpolated from `site.ts` rather than typed out: this string is the meta
// description, the OG card and the Twitter card, and a hand-written copy of a
// claim is how the site ends up contradicting the app it describes.
const description = `Two independent apps for the CLI agents you already use. Uxnan Desktop runs them in about ${RAM_FOOTPRINT} so modest PCs stay in the game. Uxnan Mobile steers those agents from your phone without a vendor app stack — end-to-end encrypted, open source.`;

/** Social preview card (`public/og.png`), 1200×630. */
const ogImage = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "Uxnan — power for agents, not wasted on chrome",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Uxnan — power for agents, not wasted on chrome",
    template: "%s · Uxnan",
  },
  description,
  applicationName: "Uxnan",
  keywords: [
    "AI coding agents",
    "Claude Code",
    "Codex CLI",
    "OpenCode",
    "git worktrees",
    "agent development environment",
    "Tauri",
    "lightweight IDE alternative",
    "remote control coding agent",
    "end-to-end encrypted",
    "open source",
  ],
  authors: [{ name: "Luis Donaldo Gamas Vazquez" }],
  creator: "Luis Donaldo Gamas Vazquez",
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Uxnan",
    title: "Uxnan — power for agents, not wasted on chrome",
    description,
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "Uxnan — power for agents, not wasted on chrome",
    description,
    images: [ogImage],
  },
  icons: {
    icon: [{ url: "/logo.svg", type: "image/svg+xml" }],
  },
  // Canonical is set per page (each route is a server component that exports its
  // own), never globally here — a global "/" would tell Google /download is a
  // duplicate of the home page.
  // Search Console's HTML-tag method. Optional: verifying by DNS on Cloudflare
  // needs no token. If you use the meta-tag method instead, set
  // NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION and it is emitted here.
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? {
        verification: {
          google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
        },
      }
    : {}),
};

/**
 * Structured data (schema.org JSON-LD). It tells search engines and AI crawlers,
 * in a machine-readable form, that this is Uxnan — a website and organisation
 * publishing two free developer applications — so a result or an answer can be
 * built without scraping prose. Facts mirror `site.ts`; keep them in sync.
 */
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: `${siteUrl}/`,
      name: "Uxnan",
      description,
      inLanguage: "en",
      publisher: { "@id": `${siteUrl}/#org` },
    },
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#org`,
      name: "Uxnan",
      url: `${siteUrl}/`,
      logo: `${siteUrl}/logo.svg`,
      sameAs: [links.github],
    },
    {
      "@type": "SoftwareApplication",
      name: "Uxnan Desktop",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Windows, macOS, Linux",
      description: `A terminal-native workspace that runs several CLI coding agents in parallel in about ${RAM_FOOTPRINT} of RAM — a ${RAM_CORE} core plus the OS webview, rather than the second browser an Electron shell bundles (${ELECTRON_RAM}).`,
      url: `${siteUrl}/`,
      downloadUrl: links.releases,
      license: links.license,
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@id": `${siteUrl}/#org` },
    },
    {
      "@type": "MobileApplication",
      name: "Uxnan Mobile",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Android",
      description:
        "Drives the CLI coding agents already running on your PC, from your phone, over an end-to-end encrypted channel — no vendor app stack required.",
      url: `${siteUrl}/`,
      license: links.license,
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@id": `${siteUrl}/#org` },
    },
  ],
};

export const viewport: Viewport = {
  // Dark is the default regardless of the OS preference (same rule the toggle
  // itself follows — see `themeScript`), so the browser chrome hint is a single
  // static colour rather than a `prefers-color-scheme` pair.
  themeColor: "#101218",
  width: "device-width",
  initialScale: 1,
};

/**
 * Applies the stored theme before first paint. Dark is the default: a visitor
 * with no stored preference always gets the dark design, and light is only
 * shown once they have explicitly chosen it — the system's own light/dark
 * preference is never consulted, so the toggle is the one source of truth.
 */
const themeScript = `(function(){var d=document.documentElement;d.classList.add("js");try{var t=localStorage.getItem("uxnan-theme");if(t==="light"){d.style.colorScheme="light";}else{d.classList.add("dark");d.style.colorScheme="dark";}}catch(e){d.classList.add("dark");}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The inline script below stamps `js`, `dark` and `color-scheme` onto <html>
    // before React hydrates, which is exactly the mismatch this suppresses.
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script
          type="application/ld+json"
          // Static, build-time constant — no user input flows into it.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-6 focus:top-6 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-5 focus:py-3 focus:text-accent-foreground"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
