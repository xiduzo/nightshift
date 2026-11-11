# Computers and Hosts

Night Shift runs on each of your computers. To join them, run one of them as a **Host**. A Host keeps your projects, flows, schedules, and secrets, and your other computers sync with it. Your phone connects to the Host too.

| Word | Means |
| --- | --- |
| **Device** | One computer that runs Night Shift. |
| **Host** | The Device that the other Devices sync with. It runs every schedule. |
| **Space** | A group of people, with their projects, runs, Gates, and secrets. |
| **Personal** | Your own Space. Only you see it. |
| **Offer** | One of your profiles that a Space may use. |

## Run a Host

`nightshift` is Night Shift in one file: the server, the web UI, and the database. It runs on Linux (x64, arm64) and macOS (arm64).

- Run the Docker image `ghcr.io/xiduzo/nightshift:nightly`, or build the file from source.
- Docker Compose and systemd recipes are in [deploy/](https://github.com/xiduzo/nightshift/tree/main/deploy).
- In the desktop app, turn on **Be a Host** under Settings → This computer.

A Host answers your other computers only at an `https://` address. Pick a way out:

| Way out | Use it when |
| --- | --- |
| [Your LAN](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/lan.md) | Your computers are at home or in one office. |
| [A tailnet](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/tailnet.md) | Your computers use Tailscale. |
| [A public server](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/public-server.md) | You have a VPS or Dokploy, and a domain. |
| [An outbound tunnel](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/tunnel.md) | Your Host is at home, without Tailscale and without an open port. |

[Run a Host without a screen](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/README.md) has the commands, the settings, and the backups.

## Pair a computer

1. On the computer, choose **Settings → This computer → Join a Host**, or run `nightshift join <host-address>`.
2. Night Shift shows a code.
3. On the Host, open **Devices**, choose **Pair a device**, and enter the code. Or run `nightshift pair <code>` on the Host.
4. The computer connects when you allow it.

When a computer joins its home Host, its Personal projects and flows move into your Personal there. You see the same Personal on all your computers and on your phone. `nightshift merge` shows what moves before it moves.

To join the Host of another person, use `nightshift join <host-address> --guest`. A guest Host never gets your Personal.

To end the pairing, run `nightshift leave`. The Host keeps everything. This computer keeps its own Personal. Night Shift pauses its schedules, because the Host still runs them.

### One computer is one Device

A reinstall on the same computer gets its Device back, with its profiles, CLI tools, and connections. Secrets that you saved on this computer do not come back.

The Host refuses a pairing while the other install of that Device is online. Quit the other install, then pair again. After a pairing, Night Shift can ask you to restart it.

## Spaces

A Space shares projects, runs, Gates, and secrets with the people you invite. Each person gets a role:

| Role | Can |
| --- | --- |
| Owner | Everything an admin can, and delete the Space. |
| Admin | Everything a member can. Invite people, change roles, and remove Members on the Members page. |
| Member | Start runs, answer Gates, add projects, and save flows. |
| Viewer | Read only. A viewer sees Gates, but cannot answer them. |

A Host is invitation-only. Nobody makes an account without an invitation link from a Member.

### Offers

An Offer lets a Space use one of your profiles. Each Offer sets two limits: the widest permission mode, and how many sessions run at once. A step of another person runs on your computer only through an Offer.

## Where a step runs

- A node names a profile and its computer. The step runs there.
- A node can list [backups](Agents-and-profiles.md#backups) on other computers.
- A step that names no profile runs on the first computer of the run that can take it.
- A schedule's run starts on the Host. See [Runs and schedules](Runs-and-schedules.md#schedules).

Night Shift moves the work of the run between the computers for you.

## Secrets

A `${NAME}` in a connection, a CLI tool login, or a webhook reads a secret. A secret has a scope:

| Scope | Where you save it | Who reads it |
| --- | --- | --- |
| **This computer** | The **Secrets** page of that computer | Steps on that computer. |
| **Personal** | The **Secrets** page | Your own steps on your own computers. Never a step on a Host, also your own Host. |
| **Project** | The project's **Project secrets** page | Every step of the project's runs, on any computer. |
| **Space** | The **Space secrets** page | Every step of the Space's runs, on any computer. |

When two scopes have the same name, the most specific one wins: Personal, then Space, then Project, then This computer, then the environment.

On a Host, save a secret as Space, Project, or This computer. A Personal secret does not work there.

## The Host copies your GitHub projects

A Host copies each project with a `github.com` remote, so it can run work without your other computers. It looks for new projects every minute.

- A private repository needs `gh` signed in on the Host. In Docker, set `GH_TOKEN` in the container.
- To stop it, turn off **Copy every project** under Settings → This computer, or set `NIGHTSHIFT_COPY_PROJECTS=off`.

## A project without a folder

A [project without a folder](Get-started.md#a-project-without-a-folder) needs no copy on any computer. So the Host runs its schedules without GitHub, and every computer of the Space can run its steps.

- Each computer that runs a step works in a folder of its own for that run. See [The files of a run](Runs-and-schedules.md#the-files-of-a-run).
- A step that works in that folder does not move to a backup. It waits for its computer.
- To add such a project in a Space that a Host keeps, the Host needs a recent Night Shift.

## Web requests from a Host

A Web request and a Wait for a URL on a Host reach public addresses only. The Host runs the flows of every Member of its Spaces, so its own network stays closed by default.

- To let them reach the Host itself and its private network, turn on **Web requests reach this network** under Settings → This computer, or set `NIGHTSHIFT_WEB_REQUESTS_PRIVATE_NETWORK=on`.
- No web request reaches a link-local or a cloud metadata address, on any computer.
