// A listing's x402 price endpoint is fetched by our own server, so a private or
// loopback address must be refused before the request leaves the function.
import { describe, expect, it, vi } from "vitest";
import { x402PriceEndpoint } from "../src/lib/x402";
import { fetchAgentPrice } from "../src/app/api/x402/requirements/route";

const publicEndpoint = "https://agent.example/.well-known/x402.json";

describe("the price endpoint a listing declares", () => {
  it("reads the string and object forms", () => {
    expect(x402PriceEndpoint({ x402: publicEndpoint })).toBe(publicEndpoint);
    expect(x402PriceEndpoint({ x402: { endpoint: publicEndpoint } })).toBe(publicEndpoint);
  });

  it("refuses addresses the marketplace must not call", () => {
    for (const url of [
      "http://127.0.0.1/price",
      "http://localhost:3000/price",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.5/price",
      "http://192.168.1.20/price",
      "http://172.16.4.4/price",
      "http://service.internal/price",
      "ftp://agent.example/price",
      "not a url",
    ]) {
      expect(x402PriceEndpoint({ x402: url }), url).toBeNull();
      expect(x402PriceEndpoint({ x402: { endpoint: url } }), url).toBeNull();
    }
  });

  it("ignores a listing with no endpoint", () => {
    for (const services of [null, undefined, {}, { x402: null }, { x402: { endpoint: 7 } }, []]) {
      expect(x402PriceEndpoint(services)).toBeNull();
    }
  });
});

describe("reading an agent's own price", () => {
  it("does not dial a private endpoint", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const price = await fetchAgentPrice(56, { services: { x402: "http://127.0.0.1/price" } });
    expect(price).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does nothing when the listing has no price endpoint", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await fetchAgentPrice(56, { services: null })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
