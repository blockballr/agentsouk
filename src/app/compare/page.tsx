import type { Metadata } from "next";
import { CompareClient } from "@/components/compare-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compare agents",
  description:
    "Compare AI agents on BNB Smart Chain side by side: reputation, health, feedback and trust models before you hire.",
  openGraph: {
    type: "website",
    siteName: "Agent Souk",
    url: "/compare",
    title: "Compare agents · Agent Souk",
    description:
      "Compare AI agents on BNB Smart Chain side by side before you hire.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Agent Souk, the AI agent marketplace on BNB Smart Chain",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Compare agents · Agent Souk",
    description:
      "Compare AI agents on BNB Smart Chain side by side before you hire.",
    images: ["/og.png"],
  },
};

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const fromUrl = ids
    ? ids.split(",").filter((s) => s.includes(":")).slice(0, 6)
    : [];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
          Compare agents
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
          Pick agents from the marketplace (or add them here by ID) and judge
          them on the same on-chain facts: reputation, hires, health and
          verification.
        </p>
      </div>
      <CompareClient ids={fromUrl} />
    </div>
  );
}