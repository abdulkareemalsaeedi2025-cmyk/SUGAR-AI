# Smart Sugar AI — all-in-one container (works on Koyeb, Fly.io, Render, any Docker host).
# Node 24: node:sqlite stable locally; cloud mode (DATABASE_URL) uses Postgres only.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Render/Koyeb/Fly inject PORT; Next reads it via the start command below.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.* ./
COPY --from=build /app/middleware.ts ./middleware.ts
COPY --from=build /app/lib ./lib
COPY --from=build /app/app ./app
COPY --from=build /app/scripts ./scripts
EXPOSE 3000
CMD ["sh", "-c", "node node_modules/next/dist/bin/next start -p ${PORT:-3000}"]
