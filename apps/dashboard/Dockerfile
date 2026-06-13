# Production image for the Sveltry SvelteKit dashboard (adapter-node).
# Build from the REPO ROOT so the Bun workspace + generated Convex API resolve:
#
#   docker build -f apps/dashboard/Dockerfile -t sveltry-dashboard .
#   docker run -p 3000:3000 --env-file apps/dashboard/.env sveltry-dashboard

FROM oven/bun:1.3.11 AS build
WORKDIR /repo

# Install workspace dependencies (cached on lockfile changes).
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/backend/package.json apps/backend/
COPY packages/types/package.json packages/types/
COPY packages/protocol/package.json packages/protocol/
COPY packages/sdk/package.json packages/sdk/
RUN bun install --frozen-lockfile

# Bring in the sources and build the dashboard.
COPY . .
RUN cd apps/dashboard && bun run build

FROM oven/bun:1.3.11-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /repo/apps/dashboard/build ./build
COPY --from=build /repo/apps/dashboard/package.json ./package.json
EXPOSE 3000
CMD ["bun", "./build/index.js"]
