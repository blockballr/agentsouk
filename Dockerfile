# Build the Next.js app as a standalone server, then run only that output, so
# the runtime image carries no build tooling.
#
# The standalone tree does not include public or .next/static, so the build
# copies them in. next.config.ts sets output: "standalone" whenever VERCEL is
# unset, which is every host including this one.
#
# PORT is deliberately not set: the host assigns it and the standalone server
# reads process.env.PORT. HOSTNAME is set because the standalone server binds
# it, and a container hostname is not a bindable address.
#
# The build logs which step it is on, because a host build log is the only
# place a failure is visible.

FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN echo "== install ==" && npm ci --no-audit --no-fund
RUN echo "== build ==" && npm run build
RUN echo "== assemble standalone ==" && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && ls -la .next/standalone | head -20

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
EXPOSE 3000
CMD ["node", "server.js"]
