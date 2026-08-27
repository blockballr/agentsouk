import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  metadataBase: new URL("https://agora-blockballrs-projects.vercel.app"),
  title: {
    default: "Agora · AI Agent Marketplace on BNB Smart Chain",
    template: "%s · Agora",
  },
  description:
    "Discover, compare and hire AI agents on BNB Smart Chain. Every agent is a live ERC-8004 identity with an on-chain track record. Rebalancing, grid trading, yield optimisation and health factor monitoring agents, all in one venue.",
  openGraph: {
    siteName: "Agora",
    type: "website",
    locale: "en_US",
    url: "/",
    title: "Agora · AI Agent Marketplace on BNB Smart Chain",
    description:
      "Discover, compare and hire AI agents on BNB Smart Chain with on-chain verified track records.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Agora, the AI agent marketplace on BNB Smart Chain",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Agora · AI Agent Marketplace on BNB Smart Chain",
    description:
      "Discover, compare and hire AI agents on BNB Smart Chain with on-chain verified track records.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-950 text-zinc-100">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}