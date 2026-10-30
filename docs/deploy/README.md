# Night Shift from anywhere

A Host is the Night Shift your other computers sync with. It answers them
only at an `https://` address. This folder shows how to give a Host one, and
how to run a Host without a screen.

Pick a way out. Each one gives an `https://` address, and Night Shift treats
them all the same.

| Way out | Use it when | Address |
| --- | --- | --- |
| [Your LAN](lan.md) | Your computers are at home or in one office | `https://studio.local:3443` |
| [A tailnet](tailnet.md) | Your computers use Tailscale | `https://studio.tail1234.ts.net` |
| [A public server](public-server.md) | You have a VPS or Dokploy and a domain | `https://nightshift.example.com` |
| [An outbound tunnel](tunnel.md) | Your Host is at home, without Tailscale and without an open port | `https://nightshift.example.com` |

A public address (Funnel, a public server, a tunnel) shows Night Shift's
sign-in page to everyone. That is safe, because a Host is invitation-only.
Nobody makes an account without an invitation link from a Member. The Host
admin exists from the first start. Night Shift limits sign-in attempts per
client. For more safety, [require two-factor sign-in](#require-two-factor-sign-in).
Then a password alone signs nobody in.

A Host can have several addresses. Your other computers try them in order and
keep the first that answers. Put the LAN name first, then the tailnet name,
then the public name. A computer then syncs on the LAN at home, stays private
in the tailnet, and uses the public name in a café.

## Run a Host without a screen

`nightshift` is Night Shift in one file: the daemon, its web UI and its
database. It runs on Linux (x64, arm64) and macOS (arm64).

Build it from the repository:

```bash
bun install
bun run --cwd apps/server build:binary --target all
ls apps/server/dist/bin/   # nightshift-linux-x64, nightshift-linux-arm64, nightshift-darwin-arm64
```

Check that the binary of this computer starts. CI does this on every
pull request:

```bash
bun apps/server/scripts/smoke-binary.ts
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
- `nightshift serve --help` lists every option. Each option also has an
  environment variable.

Two ready-made setups are in [`deploy/`](../../deploy/):

- [`nightshift.service`](../../deploy/nightshift.service): a systemd unit.
- [`launchd/`](../../deploy/launchd/): the same for a Mac, as launchd agents.
- [`Dockerfile`](../../deploy/Dockerfile) and
  [`docker-compose.yml`](../../deploy/docker-compose.yml): a container,
  with Caddy in front for TLS.

### The Docker image

Each release and each nightly build is on Docker Hub as
`xiduzo/nightshift` and on GitHub as `ghcr.io/xiduzo/nightshift`, for
linux/amd64 and linux/arm64:

| Tag | What it is |
| --- | --- |
| `latest` | The latest full release |
| `0.2.0`, `0.2` | A release, or the latest patch of a minor version |
| `nightly` | The latest nightly build of `main`. It can break. |
| `0.2.1-nightly.20261020.12` | One nightly build |
| `sha-1a2b3c4` | The build of one commit |

```bash
docker run -d --name nightshift -p 127.0.0.1:3000:3000 -v nightshift:/data \
  -e NIGHTSHIFT_HOST_ADDRESSES=https://nightshift.example.com xiduzo/nightshift
```

The Host shows its name in the sidebar and on the Devices page of each
computer that pairs with it. The sidebar also marks it as a Host. Set the
name with `NIGHTSHIFT_DEVICE_NAME`, for example
`-e NIGHTSHIFT_DEVICE_NAME="Office Host"`. Without it, the name is the host
name of the computer.

A container that Docker names by its id cannot see the name of its computer.
Its name is then the domain of its first Host address, else "Host". A Host
with an earlier default name (a container id, or "Host") gets the new name
when it starts.

### Add your tools

The image holds Night Shift, git and ssh. It has no agent CLIs and no other
tools. You choose them: build your own image on it, with the CLIs your flows
use. The image is [Wolfi](https://github.com/wolfi-dev), so add packages with
`apk add`. For example:

```dockerfile
FROM xiduzo/nightshift:latest
USER root
# A tool from the Wolfi packages.
RUN apk add --no-cache jq
# A CLI from npm needs Node. npm runs only the install scripts you allow.
RUN apk add --no-cache nodejs-22 npm \
  && npm install -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code@2
ENV DISABLE_AUTOUPDATER=1
USER bun
```

- Install into `/usr/local`, not into the home folder of `bun`. A volume on
  the home folder keeps old versions after you update the image.
- Pin the versions. The image then changes only when you change it.
- Go back to `USER bun` at the end. Night Shift does not run as root.
- Add each tool on the Agents page, under Tools. An Agent node can then run
  it. Give the tool its login there (below), not in the image.

For Claude Code, make a token with `claude setup-token` and set
`CLAUDE_CODE_OAUTH_TOKEN` in the environment of the container. Night Shift
does not give `ANTHROPIC_API_KEY` to Claude Code.

### Sign your CLI tools in

Give each CLI tool its login in Night Shift, not in the image. Open the
Agents page, then the tool, then Edit:

- **Login → variables.** A value can read a secret, for example
  `GH_TOKEN = ${GH_WORK_TOKEN}`. Save the secret on the Secrets page,
  or set it in the environment of the container.
- **Several accounts of one program.** Add one tool per account: `gh` and
  `gh-work` both run the program `gh`, each with its own token. The agent
  types the tool's name. Say which account it is in the description.
  A command also uses the tool's name: `acli-dimpact jira ...`, not
  `acli jira ...`. The second one runs without the login. The flow editor
  warns about such a command, and lists the tools you can insert.
- **A program that keeps its sign-in in a file**, such as acli: turn on
  "Keep its own sign-in". Night Shift keeps a folder for the tool in the
  data folder, `/data/tools/<name>`. A variable points the program at that
  folder (`HOME` for acli). Its sign-in command runs there before the first
  step, and again when a secret it reads changes. Give the token as the
  command's input, never in the command:

  ```text
  Program          acli
  Name             acli-dimpact
  Folder variable  HOME
  Sign-in command  acli jira auth login --site dimpact.atlassian.net --email you@example.com --token
  Input            ${DIMPACT_ATLASSIAN_TOKEN}
  ```

- **Git host.** In the steps that have the tool, `git push` to this host
  signs in with the tool's login, for example `github.com` for `gh`.

A step gets only the logins of its own tools. The secrets that logins
read do not reach other agents and commands, even when you set them in
the environment of the container. A Command node that names one in
`secrets` still gets it. The record of a step shows each value as `•••`.

The agent runs as the same user as Night Shift. An agent that looks for a
token in its tools can find it. Give each tool a token that can do only
what the agent needs, such as a fine-grained token for the repositories it
works on.

For other secrets, see
[Secrets on a computer without a keychain](#secrets-on-a-computer-without-a-keychain).

### Projects come to the Host by themselves

A Host copies each project of its Spaces from GitHub: a project that a
computer added, with a remote on `github.com`. Its schedules and chats can
then use the project on the Host. The copies go into
`/data/projects/<owner>/<repo>`. Night Shift looks for new projects every
minute. When a copy fails, Night Shift tries again later. Open the project
on the Host to see why it failed. "Try again" there copies it at once.

- **A private repository** needs `gh`, signed in, for Night Shift itself.
  Add `gh` to your image and set `GH_TOKEN` in the environment of the
  container. The logins of your tools are only for the steps of a flow.
  Without `gh`, the Host copies public repositories only.
- **Another git host**, such as GitLab: the Host does not copy it. Add its
  folder on the Host yourself.
- **Turn it off** under Settings → This computer → Copy every project, or
  with `NIGHTSHIFT_COPY_PROJECTS=off`.

### Keep it running

Night Shift can stop responding while it still answers web requests. Each
setup above finds this and starts Night Shift again. A run in progress
continues after the restart.

Check it yourself:

```bash
nightshift health            # Exit code 0 when Night Shift runs, else 1.
curl http://127.0.0.1:3000/health   # 200 when it runs, else 503.
```

- **systemd**: the unit has a watchdog (`WatchdogSec=30`). Night Shift
  sends a sign of life every 15 s. Without one for 30 s, systemd restarts
  it. `systemctl status nightshift` shows a restart by the watchdog.
- **Docker**: the image has a health check (`nightshift health`). Docker
  Swarm, and so Dokploy, replaces a container that is unhealthy. Plain
  Docker and Docker Compose only mark it unhealthy (`docker ps`).
- **Updates in Docker Swarm and Dokploy**: stop the old container first
  (update order `stop-first`). One data folder has one Night Shift. While
  the old container holds the database, a new one on the same volume exits
  with code 1. See
  [A public server](public-server.md#updates-stop-the-old-container-first).
- **macOS**: two launchd agents. `nightshift.serve.plist` runs
  `nightshift serve` and starts it again when it stops.
  `nightshift.health.plist` runs `nightshift health --restart` every 60 s.
  When Night Shift does not respond twice, 15 s apart, it stops Night
  Shift, and launchd starts it again.

  Put the folders of your agent CLIs (`claude`, `codex`) in the `PATH` of
  `nightshift.serve.plist`. Then install both:

  ```bash
  cd deploy/launchd
  for job in serve health; do
    sed "s|/Users/YOU|$HOME|g" nightshift.$job.plist \
      > ~/Library/LaunchAgents/nightshift.$job.plist
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/nightshift.$job.plist
  done
  ```

  The log is in `~/Library/Logs/nightshift.log`. To stop it:
  `launchctl bootout gui/$(id -u)/nightshift.serve` (and `nightshift.health`).

### Secrets on a computer without a keychain

A server has no keychain. Night Shift reads secrets from files instead:

- The auth secret: `BETTER_AUTH_SECRET`, else the file in
  `BETTER_AUTH_SECRET_FILE`, else `BETTER_AUTH_SECRET` in the secrets folder
  below. Without any of these, Night Shift makes one and keeps it in the
  data folder.
- A `${NAME}` in a connection: the environment, else a file named `NAME` in
  the secrets folder. The secrets folder is `NIGHTSHIFT_SECRETS_DIR` (for
  example `/run/secrets` in Docker), else the credentials folder of systemd
  (`LoadCredential=`).
- A secret you save on the Connections page, and the access to your Hosts,
  go in the data folder, in files only the Night Shift user can read.

### Sign in to a Host without a screen

The Host admin is Night Shift's own Person on the Host. On the Host itself,
Night Shift signs it in for you. To sign in from a browser on another
computer, first give it an email and a password. Run this on the Host:

```bash
nightshift admin --email you@example.com
# In Docker:
docker exec -it nightshift nightshift admin --email you@example.com
```

It asks for the password and does not show it. To give the password from a
script, pipe it to `--password-stdin`. Run the command again to change the
password.

Then open the Host's address in a browser, for example
`https://nightshift.example.com/login`, and sign in. Invite others from
Members. The invitation link uses the address you opened the page with.

`nightshift serve` reminds you when the Host has no sign-in yet.

### Require two-factor sign-in

With two-factor sign-in, a person enters a code from an authenticator app
(1Password, Google Authenticator, Authy) after the password. Each person
turns it on under Account in the web UI. You can also make the Host
require it for everyone who signs in from another computer:

```bash
nightshift serve --require-two-factor ...
# Or in the environment, for example in Docker:
NIGHTSHIFT_REQUIRE_TWO_FACTOR=on
```

Then a person who has not turned it on can only turn it on or sign out.
After they sign in, Night Shift shows them the setup: the password, a QR
code for the app, one code from it, and ten backup codes. Each backup code
signs in once when the app is not at hand. Save them. Under Account, a
person can make new backup codes or turn two-factor sign-in off.

The requirement does not apply to:

- The Host itself: the UI opened on the Host, or through an SSH tunnel to
  it, outside a container.
- Your paired computers. They use their own access to the Host.

Turn it on for the Host admin first:

1. Give the Host admin a password: `nightshift admin --email you@example.com`.
2. Start the Host with the requirement (`--require-two-factor` or
   `NIGHTSHIFT_REQUIRE_TWO_FACTOR=on`).
3. Open the Host's address in a browser and sign in. Night Shift asks you
   to set up two-factor sign-in. Scan the QR code, enter the code, and save
   the backup codes.

A value other than `on` or `off` stops the Host at start, so a typo never
leaves it open. Restart the Host to change it.

When the Host admin loses the app and the backup codes, run this on the
Host. It sets a new password and turns two-factor sign-in off:

```bash
nightshift admin --email you@example.com --reset-two-factor
# In Docker:
docker exec -it nightshift nightshift admin --email you@example.com --reset-two-factor
```

Then sign in and turn on two-factor sign-in again. Other people have no
reset yet. A browser they trusted still signs them in, and from there they
can make new backup codes. Ask everyone to keep their backup codes.

Sign-in and its codes allow five tries a minute per client. Behind
Cloudflare, Night Shift finds the client in `CF-Connecting-IP`. Behind
another proxy, it uses `X-Forwarded-For`. So that nobody can send these
headers themselves, keep the Host off the network behind the proxy:
`--listen 127.0.0.1`, or no published port in Docker.

### Open the UI over SSH

On the Host itself, Night Shift signs you in. From your laptop, open an SSH
tunnel and use the address it gives you:

```bash
ssh -L 3000:127.0.0.1:3000 you@server
open http://localhost:3000
```

A container sees such a request come from outside, so it asks you to sign
in. Use the sign-in from `nightshift admin`.

## Pair a computer with the Host

Do this after any of the guides.

1. On the Host, add the address. Open Settings, turn on Be a Host under This
   computer, and add the `https://` address. Or start the Host with
   `--host-address`, or set `NIGHTSHIFT_HOST_ADDRESSES`. Restart Night Shift
   when Settings asks for it.
2. On the other computer, open Settings and choose Join a Host under This
   computer. Or run:

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

## Start flows from other tools

A schedule can start its flow when a webhook arrives at the Host. Then
GitHub Actions, n8n, Make, Zapier or a script can start a run, with no
connector for each. [Start a flow from another tool](triggers.md) has the
signed webhook, a `curl` example and a GitHub Actions workflow.

## Watch your runs in a monitoring tool

Each computer can send the runs it walks to a monitoring tool you choose,
as OpenTelemetry traces and metrics. It is off by default.
[Monitoring](monitoring.md) has Grafana in one container on a laptop, SigNoz
on a Host, LangSmith through your own collector, and a Grafana dashboard.
