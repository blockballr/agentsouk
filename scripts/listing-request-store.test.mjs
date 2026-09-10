import assert from "node:assert/strict";
import { recordListingRequest, listListingRequests } from "../src/lib/listing-request-store.ts";

// recorded requests are retrievable
{
  const before = (await listListingRequests()).length;
  const ok = await recordListingRequest({
    tokenId: "45381",
    contact: "builder@example.com",
    note: "please review",
    createdAt: new Date().toISOString(),
  });
  assert.equal(ok, true, "record should succeed");
  const after = await listListingRequests();
  assert.equal(after.length, before + 1, "list should grow by one");
  const latest = after[after.length - 1];
  assert.equal(latest.tokenId, "45381", "stored tokenId should match");
  assert.equal(latest.contact, "builder@example.com", "stored contact should match");
}

console.log("listing-request store: all tests passed");
