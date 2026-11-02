# Night Shift Insights

The Night Shift team runs Insights. Insights stores anonymous usage from
installs of Night Shift.

`insights.example.com` and `ingest.example.com` are examples. Use your
own domain in their place.

The files are in [`deploy/insights/`](../../deploy/insights/):

- [`Dockerfile`](../../deploy/insights/Dockerfile) builds the app.
- [`collector.yaml`](../../deploy/insights/collector.yaml) is the Collector config.
- [`docker-compose.yml`](../../deploy/insights/docker-compose.yml) runs Postgres, the Collector, and the app.
- [`docker-compose.local.yml`](../../deploy/insights/docker-compose.local.yml) publishes the ports on one computer.

The team instance runs on Dokploy as the compose `insights` in the project `nightshift`.
Ingest is `https://ingest.xiduzo.com/nightshift`. The admin UI is
`https://insights.xiduzo.com`.

## On one computer

The command reads `INSIGHTS_DB_PASSWORD` and `INSIGHTS_AUTH_SECRET` from
the environment. Use letters and digits in `INSIGHTS_DB_PASSWORD`. The
app uses that password in the database URL.

```bash
docker compose -f deploy/insights/docker-compose.yml \
  -f deploy/insights/docker-compose.local.yml up -d --build
```

The local file publishes the Collector on port 4318 and the admin UI on
port 8787. The main file publishes no port. Postgres has no host port. The app accepts ingest on port 8788 only
inside the compose network.

## On Dokploy

These steps are for you to do on the server.

1. Create a Dokploy project named "Night Shift Insights".
2. Add Postgres, the Collector, and the app from
   [`deploy/insights/docker-compose.yml`](../../deploy/insights/docker-compose.yml).
3. Set `INSIGHTS_DB_PASSWORD` and `INSIGHTS_AUTH_SECRET` in the project
   environment. Set `INSIGHTS_ADMIN_EMAIL` and `INSIGHTS_ADMIN_PASSWORD` for
   the first admin. The app creates that admin only while no account exists.
4. Add the domain `ingest.example.com` (an example) on the Collector,
   container port 4318, path `/nightshift`, with strip path on. Other
   sources can use other paths on the same name later.
5. Add the domain `insights.example.com` (an example) on the app,
   container port 8787.
6. In Cloudflare, add a proxied DNS record for the ingest name.
7. Add a proxied DNS record for the Insights name.
8. Set the Cloudflare TLS mode to Full (strict).
9. Create a Cloudflare origin certificate.
10. Install that certificate on Traefik.

A Cloudflare Tunnel can replace the proxied DNS records and the origin
certificate. The steps for a Host tunnel are in
[An outbound tunnel](tunnel.md).

11. When the origin has a public address, allow only
    [Cloudflare IP ranges](https://www.cloudflare.com/ips/) to reach it.
12. Create a Cloudflare Access application for the Insights name.
13. Allow the email addresses of the team in that application.

Cloudflare Access is free for up to 50 users.

14. Add a WAF rate limit on the ingest host of 60 requests a minute per IP.
15. Enable daily backups for the Postgres service in Dokploy.
16. Set `NIGHTSHIFT_USAGE_ENDPOINT` on the Night Shift image build to
    `https://ingest.<your domain>/nightshift`. Night Shift adds `/v1/logs`.
17. Pass that URL as the build arg `NIGHTSHIFT_USAGE_ENDPOINT` of
    [`deploy/Dockerfile`](../../deploy/Dockerfile).

An absent build arg leaves the value empty. Night Shift sends usage only
when the value has a URL. The image workflow reads the repository
variable `NIGHTSHIFT_USAGE_ENDPOINT` when the workflow input is empty.

18. When the published image should carry the URL, set the repository
    variable `NIGHTSHIFT_USAGE_ENDPOINT` to that URL.

A Host sends usage unless `NIGHTSHIFT_USAGE` is `off`. The Host compose
file shows that line as a comment.
