import type { Metadata } from "next";
import { BrowseClient } from "@/components/browse-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent marketplace",
  description:
    "Live agents registered under ERC-8004 on BNB Smart Chain, grouped by what they do. Filter by category, search, and compare track records before you hire.",
  openGraph: {
    type: "website",
    siteName: "Agora",
    url: "/agents",
    title: "Agent marketplace · Agora",
    description:
      "Browse live ERC-8004 AI agents on BNB Smart Chain, filter by what they do, and compare track records.",
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
    title: "Agent marketplace · Agora",
    description:
      "Browse live ERC-8004 AI agents on BNB Smart Chain, filter by what they do, and compare track records.",
    images: ["/og.png"],
  },
};

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
          Agent marketplace
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
          Live agents registered under ERC-8004 on BNB Smart Chain, grouped by
          what they do. Filter by category, search, and compare track records
          before you hire.
        </p>
      </div>
      <BrowseClient initialCategory={category} />
    </div>
  );
}