import type { Metadata, Viewport } from "next";
import "./globals.css";

const site = process.env.SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "Flo · Your Assistant", template: "%s · Flo" },
  description:
    "Speak. Flo writes, answers and remembers. Private voice dictation, a screen-aware assistant, live meeting notes and to-dos that live in your MacBook notch.",
  icons: { icon: "/logo.svg" },
  openGraph: {
    title: "Flo · Your Assistant",
    description: "Private voice dictation, a screen-aware assistant and live meeting notes, right in your notch.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh overflow-x-hidden">{children}</body>
    </html>
  );
}
