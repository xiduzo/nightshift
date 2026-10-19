# Night Shift from anywhere

A Host is the Night Shift your other computers sync with. A Host answers
other computers only at an `https://` address. This folder shows how to give
a Host one, and how to run a Host without a screen.

Pick a way out. Each one ends in an `https://` address. To Night Shift they
are all the same.

| Way out | Use it when | Address |
| --- | --- | --- |
| [Your LAN](lan.md) | Your computers are at home or in one office | `https://studio.local:3443` |
| [A tailnet](tailnet.md) | Your computers use Tailscale | `https://studio.tail1234.ts.net` |
| [A public server](public-server.md) | You have a VPS or Dokploy and a domain | `https://nightshift.example.com` |
| [An outbound tunnel](tunnel.md) | Your Host is at home, without Tailscale and without an open port | `https://nightshift.example.com` |

A public address (Funnel, a public server, a tunnel) shows Night Shift's
sign-in page to everyone. That is safe: a Host is invitation-only. Nobody
makes an account without an invitation link from a Member, and the Host
admin exists from the first start.

A Host can have several addresses. Your other computers try them in order and
keep the first that answers. Put the LAN name first, then the tailnet name,
then the public name. At home a computer then syncs on the LAN, in the
tailnet it stays private, and in a café it uses the public name.

## Run a Host without a screen

`nightshift` is Night Shift in one file: the daemon, its web UI and its
database. It runs on Linux (x64, arm64) and macOS (arm64).

Build it from the repository:

```bash
bun install
bun run --cwd apps/server build:binary --target all
ls apps/server/dist/bin/   # nightshift-linux-x64, nightshift-linux-arm64, nightshift-darwin-arm64
```

Run it:

```bash
nightshift serve --data-dir /var/lib/nightshift \
  --host-address https://nightshift.example.com --listen 127.0.0.1
```

- `--data-dir` keeps the database and the run history. Back it up.
- `--host-address` makes it a Host. Repeat it for each address.
- `--listen 127.0.0.1` keeps it off the network when the way out (Caddy,
  Tailscale Serve, cloudflared) runs on the same computer.
- `nightshift serve --help` lists every option. Each option has an
  environment variable too.

Two ready-made setups are in [`deploy/`](../../deploy/):

- [`nightshift.service`](../../deploy/nightshift.service): a systemd unit.
- [`Dockerfile`](../../deploy/Dockerfile) and
  [`docker-compose.yml`](../../deploy/docker-compose.yml): a container,
  with Caddy in front for TLS.

### Secrets on a computer without a keychain

A server has no keychain. Night Shift reads secrets from files instead:

- The auth secret: `BETTER_AUTH_SECRET`, else the file in
  `BETTER_AUTH_SECRET_FILE`, else `BETTER_AUTH_SECRET` in the secrets folder
  below. Without any of these, Night Shift makes one in the data folder and
  keeps it there.
- A `${NAME}` in a connection: the environment, else a file named `NAME` in
  the secrets folder. The secrets folder is `NIGHTSHIFT_SECRETS_DIR` (for
  example `/run/secrets` in Docker), else the credentials folder of systemd
  (`LoadCredential=`).
- A secret you save on the Connections page, and the access to your Hosts,
  go in the data folder, in files only the Night Shift user can read.

### Sign in to a Host without a screen

The Host admin is Night Shift's own Person on the Host. On the Host itself
it is signed in for you. To sign in from a browser on another computer,
give it an email and a password first. Run this on the Host:

```bash
nightshift admin --email you@example.com
# In Docker:
docker exec -it nightshift nightshift admin --email you@example.com
```

It asks for the password and does not show it. To give it from a script,
pipe it in with `--password-stdin`. Run it again to change the password.

Then open the Host's address in a browser, for example
`https://nightshift.example.com/login`, and sign in. Invite others from
Members: the invitation link uses the address you opened the page with.

`nightshift serve` reminds you when the Host has no sign-in yet.

### Open the UI over SSH

On the Host itself, Night Shift signs you in. From your laptop, open an SSH
tunnel and use the address it gives you:

```bash
ssh -L 3000:127.0.0.1:3000 you@server
open http://localhost:3000
```

A container sees such a request come from outside it, so it asks you to
sign in: use the sign-in from `nightshift admin`.

## Pair a computer with the Host

Do this after any of the guides.

1. On the Host, add the address. Open Devices, turn on Be a Host, and add the
   `https://` address. Or start the Host with `--host-address`, or set
   `NIGHTSHIFT_HOST_ADDRESSES`. Restart Night Shift when the Devices page
   asks for it.
2. On the other computer, open Devices and choose Join a Host. Or run:

   ```bash
   nightshift join https://nightshift.example.com
   ```

   It shows a code.
3. On the Host, open Devices, choose Pair a device, and enter the code. On a
   Host without a screen, run this on the Host instead:

   ```bash
   nightshift pair ABCD-EFGH
   ```

   In Docker: `docker exec -it nightshift nightshift pair ABCD-EFGH`.

The other computer learns every address of the Host when it pairs. When you
add an address later, it learns it on its next connection.
