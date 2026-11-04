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
npm start -w @agora/telegram
```

Point Telegram at it once the host is live:

```
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://telegram.agentsouk.xyz/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Local development needs a public HTTPS tunnel, because Telegram will not call
plain HTTP.
