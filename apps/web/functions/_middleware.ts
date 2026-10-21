// Host routing for the Pages site: one build serves the marketing homepage, the
// app, the docs and the station, and the hostname decides which one a visitor
// gets. The apex keeps only the homepage; everything else moves to its own
// origin, so each surface has one address and its own Turnstile gate.
//
// Self typed on purpose: the web package runs tsc here without Cloudflare worker
// types, so relying on the PagesFunction global would fail the build.
interface PagesContext {
  request: Request;
  next: () => Promise<Response>;
  env: Record<string, string | undefined>;
  params: Record<string, string | string[] | undefined>;
}

const APEX_HOSTS = new Set(["agentsouk.xyz", "www.agentsouk.xyz"]);
const APP_HOST = "app.agentsouk.xyz";
const DOCS_HOST = "docs.agentsouk.xyz";
const STATION_HOST = "station.agentsouk.xyz";

// Anything the browser or a crawler asks for by path, plus /api, which the Pages
// Function proxies. These never redirect, on any host.
function isAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/api/") ||
    pathname === "/api" ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
}

function moved(host: string, pathname: string, search: string): Response {
  return Response.redirect(`https://${host}${pathname}${search}`, 308);
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const url = new URL(context.request.url);
  const host = url.hostname;
  const path = url.pathname;

  // the apex is the homepage and nothing else
  if (APEX_HOSTS.has(host)) {
    if (path === "/" || isAsset(path)) return context.next();
    if (path === "/docs" || path.startsWith("/docs/")) return moved(DOCS_HOST, "/", url.search);
    if (path === "/station" || path.startsWith("/station/")) return moved(STATION_HOST, "/", url.search);
    return moved(APP_HOST, path, url.search);
  }

  // docs and station are single-page surfaces: a deep link opens the page rather
  // than a 404, because the SPA owns the rest of the route
  if (host === DOCS_HOST || host === STATION_HOST) {
    if (path === "/" || isAsset(path)) return context.next();
    return moved(host, "/", url.search);
  }

  // the app root is the marketplace; the marketing homepage stays on the apex
  if (host === APP_HOST && path === "/") {
    return moved(APP_HOST, "/agents", url.search);
  }

  return context.next();
};
