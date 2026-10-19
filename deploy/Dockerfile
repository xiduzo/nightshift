# Night Shift as a headless Host, in a container.
#
#   docker build -f deploy/Dockerfile -t nightshift .
#   docker run -d --name nightshift --hostname nightshift \
#     -p 127.0.0.1:3000:3000 -v nightshift:/data \
#     -e NIGHTSHIFT_HOST_ADDRESSES=https://nightshift.example.com nightshift
#
# Build it from the root of the repository. The first stage compiles the
# `nightshift` binary (web UI, migrations and libsql inside), the second
# runs it. See docs/deploy/ for a proxy with TLS in front.

# The web build runs Vite on Node: Vite's prerender does not run under Bun alone.
FROM node:22-bookworm-slim AS build
COPY --from=oven/bun:1.3.10 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts \
	&& bun run postinstall \
	&& bun run --cwd apps/server build:binary \
	&& cp "apps/server/dist/bin/nightshift-linux-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')" /nightshift

FROM oven/bun:1.3.10-slim
# git for the projects and their worktrees, ssh for git remotes over SSH.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git openssh-client ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& mkdir -p /data \
	&& chown bun:bun /data
COPY --from=build /nightshift /usr/local/bin/nightshift

USER bun
ENV NIGHTSHIFT_DATA_DIR=/data \
	PORT=3000 \
	NIGHTSHIFT_HOST=on
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["nightshift"]
CMD ["serve"]
