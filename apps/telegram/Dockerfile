FROM node:22-slim

WORKDIR /app

COPY . .
RUN npm ci --omit=dev

ENV PORT=8787
EXPOSE 8787

CMD ["node", "apps/telegram/src/server.js"]
