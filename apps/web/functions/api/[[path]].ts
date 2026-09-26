// Same-origin proxy from the Pages site to the standalone API: the API host sends no CORS
// header, so direct browser calls are blocked and /api/* would fall back to the SPA.

// Self typed on purpose: the web package runs tsc here without Cloudflare worker types,
// so relying on the PagesFunction global would fail the build.
interface PagesContext {
  request: Request;
  env: Record<string, string | undefined>;
  params: Record<string, string | string[] | undefined>;
}

interface Env {
  API_ORIGIN?: string;
}

const DEFAULT_ORIGIN = "https://api.agentsouk.xyz";

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const origin = (context.env as Env).API_ORIGIN ?? DEFAULT_ORIGIN;
  const incoming = new URL(context.request.url);

  // forward the path after /api plus the query string, so the API sees the
  // route it expects rather than the proxy prefix
  const raw = context.params.path;
  const suffix = Array.isArray(raw) ? raw.join("/") : raw ?? "";
  const target = new URL(`/api/${suffix}`, origin);
  target.search = incoming.search;

  const hasBody = !["GET", "HEAD"].includes(context.request.method.toUpperCase());

  const headers = new Headers();
  for (const name of ["content-type", "accept", "authorization"]) {
    const value = context.request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: context.request.method,
      headers,
      body: hasBody ? context.request.body : undefined,
      // never cache a settlement or hire call
      cache: "no-store",
      redirect: "manual",
    });
  } catch (cause) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `The API at ${origin} could not be reached.`,
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  const outHeaders = new Headers();
  for (const name of ["content-type", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) outHeaders.set(name, value);
  }
  if (!outHeaders.has("content-type")) {
    outHeaders.set("content-type", "application/json; charset=utf-8");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
};
