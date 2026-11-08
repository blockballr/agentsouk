// The health watch needs a ten minute clock. GitHub's scheduler on this repo
// runs every scheduled workflow at a three to six hour cadence, so the watch
// cannot depend on it. Cloudflare cron triggers are minute accurate and the
// site already lives on this account.

const WATCH_URL = "https://api.agentsouk.xyz/api/cron/health";

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(callWatch(env.WATCH_URL ?? WATCH_URL, env));
  },
  // manual smoke test, gated by the same bearer the watch uses
  async fetch(request, env) {
    if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
      return new Response("unauthorized", { status: 401 });
    }
    await callWatch(env.WATCH_URL ?? WATCH_URL, env);
    return new Response("ok");
  },
};

async function callWatch(url, env) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) {
    console.error(`health watch answered ${response.status}`);
  }
}
