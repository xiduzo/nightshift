# A public server: a domain and automatic TLS

Run the Host on a VPS, or on Dokploy, behind a proxy that gets a Let's
Encrypt certificate for your domain. The address is your domain, for
example `https://nightshift.example.com`.

Tested here: the image of [`deploy/Dockerfile`](../../deploy/Dockerfile)
behind Caddy, and pairing a computer through it. The Let's Encrypt part
needs a real domain and was not tested.

Before you start:

- Point the domain's DNS (an A or AAAA record) at the server.
- Open ports 80 and 443. The proxy needs 80 to get the certificate.
- The Host's operator can read what the Host keeps. Put the Host on a server
  you control.

## With Docker Compose and Caddy

On the server, in a clone of the repository:

```bash
NIGHTSHIFT_DOMAIN=nightshift.example.com \
  docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml logs -f
```

Caddy gets the certificate and renews it. Night Shift listens only on the
compose network: Caddy is the only way in. The data is in the volume
`nightshift`. Back it up.

## With Dokploy

1. Create an Application. Source: this repository. Build type: Dockerfile,
   path `deploy/Dockerfile`, context `.`.
2. Environment: `NIGHTSHIFT_HOST_ADDRESSES=https://nightshift.example.com`.
3. Mounts: a volume at `/data`.
4. Domains: `nightshift.example.com`, container port `3000`, HTTPS on,
   certificate provider Let's Encrypt. Dokploy's Traefik then gets the
   certificate.
5. Deploy.

## Without Docker

Install the binary and the systemd unit
([`deploy/nightshift.service`](../../deploy/nightshift.service)), and put
Caddy in front:

```
nightshift.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Keep `NIGHTSHIFT_LISTEN=127.0.0.1` in the unit, so only Caddy reaches
Night Shift.

## Pair

Follow [Pair a computer with the Host](README.md#pair-a-computer-with-the-host).
On a container, approve the code with
`docker exec -it <container> nightshift pair ABCD-EFGH`.

A certificate from Let's Encrypt needs no fingerprint check: your computers
trust it already.

Do not use a proxy with its own private authority (Caddy's `tls internal`).
Your computers cannot check that certificate, and joining stops with a
message that says so.
