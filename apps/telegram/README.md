# Agent Souk Telegram service

The bot, the `initData` check, and the chat to wallet link. It never signs and
never holds funds: every command opens the Mini App, where the user's own wallet
signs.

## Endpoints

- `POST /telegram/webhook` Telegram updates, guarded by `X-Telegram-Bot-Api-Secret-Token`.
- `POST /telegram/link` `{ initData, wallet, signature }`, verified with the bot token and `viem`.
- `GET /health` `{ ok, configured }`, no secrets.

## Environment

- `TELEGRAM_BOT_TOKEN` required for the webhook and the `initData` check.
- `TELEGRAM_WEBHOOK_SECRET` required, the value given to `setWebhook`.
- `DATABASE_URL` optional; without it links live in memory and are lost on restart.
- `PUBLIC_APP_URL` the Mini App origin, default `https://app.agentsouk.xyz`.
- `TELEGRAM_ALLOWED_ORIGINS` comma separated CORS list, default the app origin and local preview.
- `PORT` default 8787.

## Run

```
node apps/telegram/src/server.js
```

## Deploy on Vercel

Create a project with Root Directory `apps/telegram`, framework preset Other,
and no build command. The functions are in `api/`, and `vercel.json` rewrites
the public paths to them:

- `/telegram/webhook` to `api/webhook`
- `/telegram/link` to `api/link`
- `/health` to `api/health`

Set the environment from the list above, then point `telegram.agentsouk.xyz` at
the project. Hobby functions have a 10 second budget and cold starts; both are
fine for a bot that answers in milliseconds.

Point Telegram at it once the host is live:

```
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://telegram.agentsouk.xyz/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Local development needs a public HTTPS tunnel, because Telegram will not call
plain HTTP.
