import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-bricolage" });

const title = "Shim · Upgrades shouldn't wobble";
const description =
  "Shim upgrades AI SDK 6 apps to 7 and opens one tested pull request. It fixes the changes the codemod and tsc miss: code that still compiles but returns different data.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#FFD84D",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bricolage.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
