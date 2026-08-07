# ═══════════════════════════════════════════════════════════════
#  Velocare Pharmacy Server — on-premise image
#  Build from the MONOREPO ROOT:
#      docker build -f apps/onprem/Dockerfile -t velocare/onprem .
#  Small enough to move to a hospital on a USB stick.
# ═══════════════════════════════════════════════════════════════
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/core/package.json  packages/core/
COPY packages/ui/package.json    packages/ui/
COPY apps/onprem/package.json    apps/onprem/
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages/core/node_modules ./packages/core/node_modules
COPY . .
RUN npx prisma generate --schema packages/core/prisma/schema.prisma \
 && npm run build -w @velocare/onprem

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache postgresql-client
COPY --from=build /repo/apps/onprem/.next/standalone ./
COPY --from=build /repo/apps/onprem/.next/static ./apps/onprem/.next/static
COPY --from=build /repo/packages/core/prisma ./prisma
COPY --from=build /repo/node_modules/.prisma ./node_modules/.prisma
EXPOSE 3000
# Migrations run at boot, so an on-site upgrade is a container restart.
CMD ["sh","-c","npx prisma migrate deploy --schema ./prisma/schema.prisma && node apps/onprem/server.js"]
