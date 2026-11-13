import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme";
import { DownloadLaunch } from "@/components/site/DownloadLaunch";

// Self-hosted (no build-time fetch from Google Fonts). Inter for UI and headlines, Instrument Serif for accents.
const sans = localFont({ src: "./fonts/Inter-normal.woff2", weight: "400 700", variable: "--font-sans-loaded", display: "swap" });
const serif = localFont({
  src: [
    { path: "./fonts/InstrumentSerif-normal.woff2", style: "normal", weight: "400" },
    { path: "./fonts/InstrumentSerif-italic.woff2", style: "italic", weight: "400" },
  ],
  variable: "--font-serif-loaded",
  display: "swap",
});

const site = process.env.SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "Flo · Your Assistant", template: "%s · Flo" },
  description:
    "Speak. Flo writes, answers and remembers. Private voice dictation, a screen-aware assistant, live meeting notes and to-dos that live in your MacBook notch.",
  icons: {
    icon: [
      { url: "/favicon.ico?v=2", sizes: "any" },
      { url: "/favicon-32x32.png?v=2", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png?v=2", type: "image/png", sizes: "16x16" },
    ],
    apple: "/apple-touch-icon.png?v=2",
  },
  manifest: "/site.webmanifest?v=2",
  openGraph: {
    title: "Flo · Your Assistant",
    description: "Private voice dictation, a screen-aware assistant and live meeting notes, right in your notch.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f6fb",
  width: "device-width",
  initialScale: 1,
};

const GTM_ID = "GTM-MN84X5WV";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/* resolve the theme before first paint: no flash of the wrong one */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh overflow-x-hidden">
        <noscript>
          <iframe src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`} height="0" width="0" style={{ display: "none", visibility: "hidden" }} />
        </noscript>
        {children}
        <DownloadLaunch />
        {/* Google Tag Manager: the standard loader (pushes gtm.start, which GTM needs before any tag fires) plus gtag() */}
        <Script id="gtm" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}
        </Script>
      </body>
    </html>
  );
}
