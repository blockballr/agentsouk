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
        url: "/agent-souk-og.png",
        width: 1280,
        height: 640,
        alt: "Agent Souk, the AI agent marketplace on BNB Smart Chain",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Compare agents · Agent Souk",
    description:
      "Compare AI agents on BNB Smart Chain side by side before you hire.",
    images: ["/agent-souk-og.png"],
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
      </div>
      <CompareClient ids={fromUrl} />
    </div>
  );
}