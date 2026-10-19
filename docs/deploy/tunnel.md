# An outbound tunnel: Cloudflare Tunnel, frp or rathole

The Host stays at home, with no open port. A small program on the Host
connects out to a server on the internet, which passes requests back
through that connection. You get a public name on your own domain, and one
more program on the Host.

Written from the documentation of each tool. Not tested here end to end.

In every case, keep Night Shift on this computer only:

```bash
nightshift serve --listen 127.0.0.1 --host-address https://nightshift.example.com
```

## Cloudflare Tunnel

Needs a Cloudflare account with your domain on it.

1. Install `cloudflared` on the Host:
   [Cloudflare's downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. Create the tunnel and its DNS name:

   ```bash
   cloudflared tunnel login
   cloudflared tunnel create nightshift
   cloudflared tunnel route dns nightshift nightshift.example.com
   ```

3. Write `~/.cloudflared/config.yml`:

   ```yaml
   tunnel: nightshift
   credentials-file: /home/you/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: nightshift.example.com
       service: http://127.0.0.1:3000
     - service: http_status:404
   ```

4. Run it, or install it as a service:

   ```bash
   cloudflared tunnel run nightshift
   sudo cloudflared service install
   ```

Cloudflare Access can put a login in front. Your other computers cannot
pass that login: they use their own access to the Host. Put Access only in
front of a Host that browsers alone use.

## frp on a VPS

A VPS with a public address runs `frps` and a proxy with TLS (Caddy). The
Host runs `frpc`.

On the VPS, `frps.toml`:

```toml
bindPort = 7000
vhostHTTPPort = 8080
auth.token = "a long random token"
```

and a Caddyfile:

```
nightshift.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

On the Host, `frpc.toml`:

```toml
serverAddr = "vps.example.com"
serverPort = 7000
auth.token = "a long random token"

[[proxies]]
name = "nightshift"
type = "http"
localIP = "127.0.0.1"
localPort = 3000
customDomains = ["nightshift.example.com"]
```

Run `frps -c frps.toml` on the VPS and `frpc -c frpc.toml` on the Host.

## rathole on a VPS

The same shape as frp, with a smaller program. On the VPS, `server.toml`:

```toml
[server]
bind_addr = "0.0.0.0:2333"

[server.services.nightshift]
token = "a long random token"
bind_addr = "127.0.0.1:8080"
```

On the Host, `client.toml`:

```toml
[client]
remote_addr = "vps.example.com:2333"

[client.services.nightshift]
token = "a long random token"
local_addr = "127.0.0.1:3000"
```

Run `rathole server.toml` on the VPS and `rathole client.toml` on the Host.
Caddy on the VPS proxies `nightshift.example.com` to `127.0.0.1:8080`, as
for frp.

## Pair

Add `https://nightshift.example.com` to the Host's addresses, after its LAN
and tailnet names. Then follow
[Pair a computer with the Host](README.md#pair-a-computer-with-the-host).

Sources: [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/),
[frp](https://github.com/fatedier/frp), [rathole](https://github.com/rapiz1/rathole).
