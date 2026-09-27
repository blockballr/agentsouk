# Build the Next.js app as a standalone server, then run only that output, so
# the runtime image carries no build tooling.
#
# The standalone tree does not include public or .next/static, so the build
# copies them in. next.config.ts sets output: "standalone" whenever VERCEL is
# unset, which is every host including this one.
#
# PORT is deliberately not set: Render assigns it and the standalone server
# reads process.env.PORT. HOSTNAME is set because the standalone server binds
# it, and a container hostname is not a bindable address.

FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build
RUN cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
EXPOSE 3000
CMD ["node", "server.js"]
