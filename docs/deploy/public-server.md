# A public server: a domain and automatic TLS

Run the Host on a VPS, or on Dokploy, behind a proxy that gets a Let's
Encrypt certificate for your domain. The address is your domain, for
example `https://nightshift.example.com`.

Tested here: the image of [`deploy/Dockerfile`](../../deploy/Dockerfile)
behind Caddy, and pairing a computer through it. Not tested: the Let's
Encrypt part, because it needs a real domain.

Before you start:

- Point the domain's DNS (an A or AAAA record) at the server.
- Open ports 80 and 443. The proxy needs 80 to get the certificate.
- Put the Host on a server you control. The Host's operator can read what
  the Host keeps.

## With Docker Compose and Caddy

On the server, in a clone of the repository:

```bash
NIGHTSHIFT_DOMAIN=nightshift.example.com \
  docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml logs -f
```

Caddy gets the certificate and renews it. Night Shift listens only on the
compose network, so Caddy is the only way in. The data is in the volume
`nightshift`. Back it up.

When Night Shift stops responding, `docker compose ps` shows it as
`unhealthy`. Docker Compose does not restart it. Restart it with
`docker compose -f deploy/docker-compose.yml restart nightshift`.

## With Dokploy

1. Create an Application. Source: this repository. Build type: Dockerfile,
   path `deploy/Dockerfile`, context `.`.
2. Environment: `NIGHTSHIFT_HOST_ADDRESSES=https://nightshift.example.com`.
3. Mounts: a volume at `/data`.
4. Domains: `nightshift.example.com`, container port `3000`, HTTPS on,
   certificate provider Let's Encrypt. Dokploy's Traefik gets the
   certificate.
5. Deploy.

Dokploy runs the Application as a Docker Swarm service. The image has a
health check. When Night Shift stops responding, Swarm replaces the
container. You do not have to set anything.

If you set your own health check (Advanced, Swarm Settings, Health Check),
keep `nightshift health` as the test. Keep a start period of at least 2
minutes:

```json
{
  "Test": ["CMD", "nightshift", "health"],
  "Interval": 30000000000,
  "Timeout": 10000000000,
  "StartPeriod": 120000000000,
  "Retries": 3
}
```

The times are in nanoseconds, as Docker takes them. The image has no
`curl`, so test with `nightshift health`, not with a web request.

### Updates: stop the old container first

One data folder has one Night Shift. Night Shift holds a lease on its
database while it runs. While the first one holds it, a second Night Shift
on the same volume exits with code 1. Thus a rolling update that starts the
new container before it stops the old one (`start-first`) fails.

Set the update order to `stop-first`. In Dokploy: Advanced, Swarm Settings,
Update Config:

```json
{
  "Parallelism": 1,
  "Order": "stop-first"
}
```

In a Swarm stack file, that is `deploy.update_config.order: stop-first`.
On SIGTERM, the old container stops cleanly and releases the lease. The new
one then starts at once, and the runs continue in it.

## Without Docker

1. Install the binary.
2. Install the systemd unit
   ([`deploy/nightshift.service`](../../deploy/nightshift.service)).
3. Put Caddy in front:

```
nightshift.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Keep `NIGHTSHIFT_LISTEN=127.0.0.1` in the unit. Then only Caddy reaches
Night Shift.

## Sign in

Give the Host admin a sign-in on the server, then sign in at
`https://nightshift.example.com/login`:

```bash
docker compose -f deploy/docker-compose.yml exec nightshift \
  nightshift admin --email you@example.com
```

Without Docker, run `nightshift admin --email you@example.com` on the
server. See [Sign in to a Host without a screen](README.md#sign-in-to-a-host-without-a-screen).

## Pair

Follow [Pair a computer with the Host](README.md#pair-a-computer-with-the-host).
On a container, approve the code with
`docker exec -it <container> nightshift pair ABCD-EFGH`.

A certificate from Let's Encrypt needs no fingerprint check. Your computers
trust it already.

Do not use a proxy with its own private authority (Caddy's `tls internal`).
Your computers cannot check that certificate. Joining then stops with a
message that says so.
