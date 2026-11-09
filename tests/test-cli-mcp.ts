// The MCP half of the CLI: a streamable HTTP answer may be one JSON message or
// an event stream, and --args has to be a JSON object.
import { describe, expect, it } from "vitest";
import { parseMcpArgs, parseMcpRpc } from "../packages/cli/src/marketplace/mcp";

describe("MCP response parsing", () => {
  it("reads one JSON message", () => {
    const rpc = parseMcpRpc('{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}', "application/json");
    expect(rpc.result).toEqual({ tools: [] });
  });

  it("reads the last JSON event from an event stream", () => {
    const text = [
      "event: message",
      'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"one"}]}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"two"}]}}',
      "",
    ].join("\n");
    const rpc = parseMcpRpc(text, "text/event-stream");
    expect(rpc.result).toEqual({ tools: [{ name: "two" }] });
  });

  it("refuses an event stream with no JSON event", () => {
    expect(() => parseMcpRpc("event: message\ndata: not-json\n", "text/event-stream")).toThrow(/no JSON event/);
  });

  it("refuses non-JSON plain text", () => {
    expect(() => parseMcpRpc("not json", "application/json")).toThrow(/non-JSON/);
  });
});

describe("MCP arguments", () => {
  it("defaults to an empty object", () => {
    expect(parseMcpArgs(undefined)).toEqual({});
    expect(parseMcpArgs("")).toEqual({});
  });

  it("accepts one JSON object", () => {
    expect(parseMcpArgs('{"address":"0x1111111111111111111111111111111111111111"}')).toEqual({
      address: "0x1111111111111111111111111111111111111111",
    });
  });

  it("refuses an array, a scalar and malformed JSON", () => {
    for (const raw of ["[]", "1", "true", "{"]) {
      expect(() => parseMcpArgs(raw)).toThrow(/JSON object/);
    }
  });
});
