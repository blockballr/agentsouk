// An agent card can name a private address as its messaging url. Calling that
// from Vercel calls the function's own loopback and throws a bare connection
// error, which reached the hirer as "Unexpected end of JSON input". These pin
// the judgement that turns it into a named, actionable refusal.
import { describe, expect, it } from "vitest";
import { privateEndpointReason } from "../src/lib/endpoint";

describe("agent endpoint reachability", () => {
  it("refuses loopback however it is written", () => {
    for (const url of [
      "http://localhost:8080/",
      "http://127.0.0.1:8080/",
      "http://127.9.9.9/",
      "http://0.0.0.0:3000/",
      "http://[::1]:8080/",
      "http://thing.localhost/",
    ]) {
      expect(privateEndpointReason(url), url).toMatch(/cannot reach/);
    }
  });

  it("refuses private and link local ranges", () => {
    for (const url of [
      "http://10.0.0.5/rpc",
      "http://192.168.1.4:8545",
      "http://172.16.0.9/",
      "http://172.31.255.1/",
      "http://169.254.1.1/",
      "https://agent.internal/",
    ]) {
      expect(privateEndpointReason(url), url).toMatch(/cannot reach/);
    }
  });

  it("allows the addresses just outside those ranges", () => {
    for (const url of [
      "http://172.15.0.1/",
      "http://172.32.0.1/",
      "http://128.0.0.1/",
      "https://8.8.8.8/",
    ]) {
      expect(privateEndpointReason(url), url).toBeNull();
    }
  });

  it("allows the public endpoint this was found on", () => {
    expect(
      privateEndpointReason("https://gridbot-production-8266.up.railway.app/.well-known/agent-card.json"),
    ).toBeNull();
  });

  it("names a malformed or non http url instead of calling it", () => {
    expect(privateEndpointReason("not a url")).toMatch(/not a valid url/);
    expect(privateEndpointReason("ftp://example.com/x")).toMatch(/not an http url/);
  });
});
