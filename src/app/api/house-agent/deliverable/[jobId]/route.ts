import { serveableManifestText } from "@/lib/seller8183";

export const dynamic = "force-dynamic";

// The seller-side deliverable url an ERC-8183 submit anchored in optParams:
// this serves the exact bytes the on-chain deliverable hash commits to, so a
// buyer verifying the manifest over HTTP reads what the chain says they
// should. Nothing is reconstructed here: whatever the manifest store holds is
// returned byte for byte.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId: rawJobId } = await params;
  const jobId = decodeURIComponent(rawJobId ?? "");
  if (!/^\d+$/.test(jobId)) {
    return new Response("the deliverable is addressed by the kernel's job id", { status: 400 });
  }
  const text = await serveableManifestText(jobId);
  if (!text) {
    return new Response(`no deliverable is stored for job ${jobId}`, { status: 404 });
  }
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
