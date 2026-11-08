import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-bricolage" });

const title = "Shim · Upgrades shouldn't wobble";
const description =
  "When an API you depend on changes, Shim opens one tested pull request. Today: AI SDK 6 to 7 and Zod 3 to 4, including the changes the codemods and tsc miss.";

export const metadata: Metadata = {
  metadataBase: new URL("https://getshim.dev"),
  alternates: { canonical: "/" },
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
  },
  twitter: { card: "summary_large_image" },
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
