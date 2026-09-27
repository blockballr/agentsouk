// Agents advertise the url the marketplace should call. A card can name a
// private address, and calling that from a serverless function means calling the
// function's own loopback, which fails with a bare connection error. Judging
// reachability here keeps that failure out of the request path and gives the
// hirer the address that is wrong.

export function privateEndpointReason(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `"${url}" is not a valid url`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `"${url}" is not an http url`;
  }
  // URL.hostname keeps the brackets on an ipv6 literal
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback =
    host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host);
  const privateV4 =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host);
  if (loopback || privateV4) {
    return `"${url}" is a private address that the marketplace cannot reach`;
  }
  return null;
}
