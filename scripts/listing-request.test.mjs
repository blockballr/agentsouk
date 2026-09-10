import assert from "node:assert/strict";
import { validateListingRequest } from "../src/lib/listing-request.ts";

// valid request passes
{
  const r = validateListingRequest({ tokenId: "45381", contact: "builder@example.com", note: "" });
  assert.equal(r.ok, true, "valid request should pass");
}

// missing token id fails
{
  const r = validateListingRequest({ tokenId: "", contact: "builder@example.com", note: "" });
  assert.equal(r.ok, false, "missing tokenId should fail");
}

// non-numeric token id fails
{
  const r = validateListingRequest({ tokenId: "abc", contact: "builder@example.com", note: "" });
  assert.equal(r.ok, false, "non-numeric tokenId should fail");
}

// missing contact fails
{
  const r = validateListingRequest({ tokenId: "45381", contact: "   ", note: "" });
  assert.equal(r.ok, false, "missing contact should fail");
}

// overlong note fails
{
  const r = validateListingRequest({ tokenId: "45381", contact: "@builder", note: "x".repeat(501) });
  assert.equal(r.ok, false, "overlong note should fail");
}

console.log("listing-request validation: all tests passed");
