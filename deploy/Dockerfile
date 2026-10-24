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
#
# The Host's name is NIGHTSHIFT_DEVICE_NAME, else the host name. A host name
# that is the container id gives the domain of the first Host address.
#
# CI publishes the second stage as xiduzo/nightshift on Docker Hub and as
# ghcr.io/xiduzo/nightshift (.github/workflows/docker.yml). It holds Night
# Shift, git and ssh only: no agent CLIs, no tools. Build your own image on
# it with the CLIs your flows use (docs/deploy/README.md, "Add your tools").

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

# Plain Debian, not the Bun image: the binary holds its own Bun, and the Bun
# image keeps the Debian packages of the day Bun shipped. `apt-get upgrade`
# takes the security fixes Debian has made since its own image.
FROM debian:trixie-slim AS runtime
# git for the projects and their worktrees, ssh for git remotes over SSH.
# The `bun` user (uid 1000) stays, for the images built on this one.
RUN apt-get update \
	&& apt-get upgrade -y \
	&& apt-get install -y --no-install-recommends git openssh-client ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& groupadd --gid 1000 bun \
	&& useradd --uid 1000 --gid bun --create-home --shell /bin/sh bun \
	&& mkdir -p /data \
	&& chown bun:bun /data
COPY --from=build /nightshift /usr/local/bin/nightshift

USER bun
WORKDIR /home/bun
ENV NIGHTSHIFT_DATA_DIR=/data \
	PORT=3000 \
	NIGHTSHIFT_HOST=on
VOLUME /data
EXPOSE 3000
# Healthy while Night Shift's heartbeat in the database is fresh. It reads
# the database in NIGHTSHIFT_DATA_DIR, not HTTP: a Night Shift whose timers
# stopped still answers HTTP. Docker Swarm (and Dokploy) replaces an
# unhealthy container. Plain Docker and Docker Compose only mark it
# unhealthy. The start period covers the database setup and the runs it
# picks up again.
HEALTHCHECK --interval=30s --timeout=10s --start-period=2m --retries=3 \
	CMD ["nightshift", "health"]
ENTRYPOINT ["nightshift"]
CMD ["serve"]
