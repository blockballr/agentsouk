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

function subpath(pathname: string, prefix: string): string {
  return pathname.slice(prefix.length) || "/";
}

// crawlers do not run the bundle, so the quest card has to be in the html they fetch
const QUEST_CARD = {
  title: "Set and Earn on Agent Souk",
  description:
    "Hire agents that do real work, in the vault or by job escrow, list one of your own, and finish the quest. Every stamp is backed by a settled hire.",
  url: "https://app.agentsouk.xyz/quest",
  image: "https://app.agentsouk.xyz/quest-og.png",
  alt: "Set and Earn: hire agents in the vault or by job escrow, list one of your own, and finish the quest.",
};

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setMeta(html: string, attr: "property" | "name", key: string, content: string): string {
  const tag = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="[^"]*"\\s*/>`);
  return html.replace(tag, `<meta ${attr}="${key}" content="${escapeAttr(content)}" />`);
}

function questCard(html: string): string {
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(QUEST_CARD.title)}</title>`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${QUEST_CARD.url}" />`);
  out = setMeta(out, "property", "og:title", QUEST_CARD.title);
  out = setMeta(out, "property", "og:description", QUEST_CARD.description);
  out = setMeta(out, "property", "og:url", QUEST_CARD.url);
  out = setMeta(out, "property", "og:image", QUEST_CARD.image);
  out = setMeta(out, "property", "og:image:alt", QUEST_CARD.alt);
  out = setMeta(out, "name", "twitter:image", QUEST_CARD.image);
  return out;
}

async function withQuestCard(context: PagesContext): Promise<Response> {
  const response = await context.next();
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(questCard(await response.text()), { status: response.status, headers });
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const url = new URL(context.request.url);
  const host = url.hostname;
  const path = url.pathname;

  // the apex is the homepage and nothing else
  if (APEX_HOSTS.has(host)) {
    if (path === "/" || isAsset(path)) return context.next();
    if (path === "/docs" || path.startsWith("/docs/")) return moved(DOCS_HOST, subpath(path, "/docs"), url.search);
    if (path === "/station" || path.startsWith("/station/")) return moved(STATION_HOST, subpath(path, "/station"), url.search);
    return moved(APP_HOST, path, url.search);
  }

  // docs and station are single-page surfaces: a deep link opens the page rather
  // than a 404, because the SPA owns the rest of the route
  if (host === DOCS_HOST || host === STATION_HOST) {
    if (path === "/" || isAsset(path)) return context.next();
    return moved(host, "/", url.search);
  }

  // the app host owns the app, the manual lives on its own origin, and the quest
  // needs its card in the html a crawler receives
  if (host === APP_HOST) {
    if (path === "/docs" || path.startsWith("/docs/")) return moved(DOCS_HOST, subpath(path, "/docs"), url.search);
    if (path === "/quest") return withQuestCard(context);
    if (path === "/") return moved(APP_HOST, "/agents", url.search);
  }

  return context.next();
};
