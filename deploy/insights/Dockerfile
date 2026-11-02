# Night Shift Insights: the admin UI and the ingest listener.
#
#   docker build -f deploy/insights/Dockerfile -t nightshift-insights .
#
# Build it from the root of the repository. The first stage builds the
# admin UI. The second runs `bun run start`. The process reads
# DATABASE_URL and BETTER_AUTH_SECRET at start. Do not put a secret here.
#
# The admin UI listens on 8787. Ingest listens on 8788. In Compose, set
# INSIGHTS_INGEST_HOST=0.0.0.0 so the Collector can reach ingest. Do not
# publish port 8788.

# The UI build runs Vite on Node, as the Host image does.
FROM node:22-bookworm-slim AS build
COPY --from=oven/bun:1.3.10 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts \
	&& bun run postinstall \
	&& bun run --cwd apps/insights build

FROM oven/bun:1.3.10 AS runtime
WORKDIR /src
COPY --from=build /src /src
WORKDIR /src/apps/insights
ENV NODE_ENV=production
USER bun
EXPOSE 8787 8788
# The admin UI answers while the process runs. Dokploy replaces an
# unhealthy container. Compose only marks it unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD ["bun", "-e", "const res = await fetch('http://127.0.0.1:8787/'); process.exit(res.ok ? 0 : 1)"]
CMD ["bun", "run", "start"]
