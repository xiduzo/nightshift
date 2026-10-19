# A tailnet: Tailscale Serve and Funnel

Tailscale gives the Host a name in your tailnet with a Let's Encrypt
certificate, for example `https://studio.tail1234.ts.net`. You open no port
on your router.

- **Serve** publishes the Host to the devices in your tailnet only.
- **Funnel** publishes the same Host to the public internet.

Written from the Tailscale documentation. It is not tested here: this
computer has no `tailscale` CLI.

## 1. Prepare the tailnet

1. Install Tailscale on the Host and log in:
   [tailscale.com/download](https://tailscale.com/download). On Linux:

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```

2. In the admin console, turn on MagicDNS and HTTPS certificates
   (DNS page). The Host's name is then `<machine>.<tailnet>.ts.net`.

## 2. Serve the Host to the tailnet

Keep Night Shift on this computer only. Tailscale reaches it there.

```bash
nightshift serve --listen 127.0.0.1 \
  --host-address https://studio.tail1234.ts.net
sudo tailscale serve --bg 3000
tailscale serve status
```

`tailscale serve` proxies `https://studio.tail1234.ts.net` to
`http://127.0.0.1:3000`. Night Shift sees each request come through a proxy,
so a request from the tailnet never acts as this computer's owner.

The first request can take a moment: Tailscale gets the certificate then.

## 3. Optional: Funnel for the public internet

Funnel publishes the same name to everyone. Read the caveats first:

- Funnel is in beta.
- Funnel limits the bandwidth, and you cannot change the limit.
- Funnel does no login check of its own. Anyone can reach the Host, so
  Night Shift's own sign-in is the only check. Pairing still needs your
  approval on the Host.
- Funnel listens on port 443, 8443 or 10000 only.
- Your tailnet policy must give the Host the `funnel` attribute.

```bash
sudo tailscale funnel --bg 3000
tailscale funnel status
```

The address stays `https://studio.tail1234.ts.net`. A computer outside the
tailnet now reaches it too.

## 4. Pair

Add `https://studio.tail1234.ts.net` to the Host's addresses, after the LAN
name if it has one. Then follow
[Pair a computer with the Host](README.md#pair-a-computer-with-the-host).

To stop: `sudo tailscale serve reset` (this also stops Funnel).

Sources: [Tailscale Serve](https://tailscale.com/kb/1312/serve),
[Tailscale Funnel](https://tailscale.com/kb/1223/funnel),
[HTTPS certificates](https://tailscale.com/kb/1153/enabling-https).
