// The ten minute clock. GitHub's scheduler on this repo runs every scheduled
// workflow at a three to six hour cadence, so both the health watch and the
// vault sweep cannot depend on it. Cloudflare cron triggers are minute accurate
// and the site already lives on this account.

const WATCH_URL = "https://api.agentsouk.xyz/api/cron/health";
const EXECUTE_URL = "https://api.agentsouk.xyz/api/vault/execute?policy=grid";

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      Promise.allSettled([
        call(env.WATCH_URL ?? WATCH_URL, env, "health watch"),
        call(env.EXECUTE_URL ?? EXECUTE_URL, env, "vault sweep"),
      ]),
    );
  },
  // manual smoke test, gated by the same bearer the watch uses
  async fetch(request, env) {
    if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
      return new Response("unauthorized", { status: 401 });
    }
    await call(env.WATCH_URL ?? WATCH_URL, env, "health watch");
    return new Response("ok");
  },
};

async function call(url, env, label) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) {
    console.error(`${label} answered ${response.status}`);
  }
}
