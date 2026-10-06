FROM node:24-bookworm-slim AS base
RUN npm install -g pnpm@10.30.3
WORKDIR /app
FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build
RUN pnpm prune --prod
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 MEDIA_ROOT=/app/media
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY src/shared/db/migrations ./src/shared/db/migrations
COPY migrate.mjs ./
RUN mkdir /app/media && chown node:node /app/media
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
