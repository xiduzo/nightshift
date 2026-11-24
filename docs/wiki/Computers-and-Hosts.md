# Computers and Hosts

Night Shift runs on your own computer. One computer is enough to start. This page tells you how to save secrets, and when and how to add a Host: Night Shift on a computer that is always on.

## Do you need a Host?

You do not need a Host to build and run flows. You need one when:

- **Your schedules must run while your laptop sleeps.** A Host runs every schedule.
- **You want the phone app.** Your phone connects to a Host.
- **You use more than one computer.** Each computer syncs its projects and flows with the Host.
- **You work with other people.** A Host keeps a Space that you share with them.

A Host can be a small server, a computer at home that is always on, or the desktop app on such a computer.

## Secrets

A secret is a password, a token, or a key, such as an API key for a web service. You save it once. A node reads it as `${NAME}`, and Night Shift never shows its value. Kits that send a message or an email need secrets too.

### Save a secret

1. Open the Settings menu at the bottom of the sidebar, and choose **Secrets**.
2. Choose **Add secret**.
3. In **Name**, type a name in capitals, for example `WEATHER_API_KEY`.
4. In **Value**, paste the secret. Nobody sees it again.
5. Under **Who can use it**, choose **Personal** or **This computer**.
6. Choose **Save**.

Then use it in a node. For example, in a header of a Web request:

```text
Authorization: Bearer ${WEATHER_API_KEY}
```

A `${NAME}` works in a Web request, a connection, a CLI tool login, the address of a Model Profile, and a webhook. A Command step gets each secret as an environment variable.

### Who can read a secret

Each secret has a scope:

| Scope | Where you save it | Who reads it |
| --- | --- | --- |
| **This computer** | The **Secrets** page of that computer | Steps on that computer. |
| **Personal** | The **Secrets** page | Your own steps on your own computers. Never a step on a Host, also not on your own Host. |
| **Project** | The **Secrets** page of the project, in its ⋯ menu in the sidebar | Every step of the runs of the project, on any computer. |
| **Space** | **Secrets** under **Space** in the Settings menu | Every step of the runs of the Space, on any computer. |

When two scopes have the same name, the most specific one wins: Personal, then Space, then Project, then This computer, then the environment.

On a Host, save a secret as Space, Project, or This computer. A Personal secret does not work there.

## Run a Host

The simplest Host is the desktop app on a computer that is always on:

1. On that computer, open **Settings**, then **This computer**.
2. Turn on **Be a Host**.

To run a Host on a server, use the Docker image `ghcr.io/xiduzo/nightshift:nightly`. Docker Compose and systemd recipes are in [deploy/](https://github.com/xiduzo/nightshift/tree/main/deploy). [Run a Host without a screen](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/README.md) has the commands, the settings, and the backups.

A Host answers your other computers only at an `https://` address. Pick how your computers reach it:

| Way | Use it when |
| --- | --- |
| [Your LAN](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/lan.md) | Your computers are at home or in one office. |
| [A tailnet](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/tailnet.md) | Your computers use Tailscale. |
| [A public server](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/public-server.md) | You have a VPS or Dokploy, and a domain. |
| [An outbound tunnel](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/tunnel.md) | Your Host is at home, without Tailscale and without an open port. |

## Pair a computer

1. On the computer, choose **Settings → This computer → Join a Host**.
2. Night Shift shows a code.
3. On the Host, open **Devices**, choose **Pair a device**, and enter the code.
4. The computer connects when you allow it.

When a computer joins its home Host, its Personal projects and flows move into your Personal there. You then see the same Personal on all your computers and on your phone.

To connect your phone, see [Phone app](Phone-app.md).

### One computer is one Device

Night Shift calls each computer that runs it a **Device**.

- A reinstall on the same computer gets its Device back, with its profiles, CLI tools, and connections. Secrets that you saved on this computer do not come back.
- The Host refuses a pairing while the other install of that Device is online. Quit the other install, then pair again.
- After a pairing, Night Shift can ask you to restart it.

## Spaces

A Space is a group of people, with their projects, runs, Gates, and secrets. **Personal** is your own Space. Only you see it.

To work with other people, invite them to a Space on your Host. Each person gets a role:

| Role | Can |
| --- | --- |
| Owner | Everything an admin can, and delete the Space. |
| Admin | Everything a member can. Invite people, change roles, and remove Members on the Members page. |
| Member | Start runs, answer Gates, add projects, and save flows. |
| Viewer | Read only. A viewer sees Gates, but cannot answer them. |

A Host is invitation-only. Nobody makes an account without an invitation link from a Member.

### Offers

An Offer lets a Space use one of your profiles. A step of another person runs on your computer only through an Offer. Each Offer sets two limits: the widest permission mode, and how many sessions run at once.

## Where a step runs

- A node names a profile and its computer. The step runs there.
- A node can list [backups](Agents-and-profiles.md#backups) on other computers.
- A step that names no profile runs on the first computer of the run that can take it.
- The run of a schedule starts on the Host. See [Runs and schedules](Runs-and-schedules.md#schedules).

Night Shift moves the work of the run between the computers for you.

## The Host copies your GitHub projects

A Host copies each project with a `github.com` remote. Then it can run work without your other computers. It looks for new projects every minute.

- A private repository needs `gh` signed in on the Host. In Docker, set `GH_TOKEN` in the container.
- To stop the copies, turn off **Copy every project** under Settings → This computer, or set `NIGHTSHIFT_COPY_PROJECTS=off`.

## A project without a folder

A [project without a folder](Get-started.md#a-project-without-a-folder) needs no copy on any computer. So the Host runs its schedules without GitHub, and every computer of the Space can run its steps.

- Each computer that runs a step works in a folder of its own for that run. See [The files of a run](Runs-and-schedules.md#the-files-of-a-run).
- A step that works in that folder does not move to a backup. It waits for its computer.
- To add such a project in a Space that a Host keeps, the Host needs a recent version of Night Shift.

## Web requests from a Host

A Web request and a Wait for a URL on a Host reach public addresses only. The Host runs the flows of every Member of its Spaces, so its own network stays closed by default.

- To let them reach the Host itself and its private network, turn on **Web requests reach this network** under Settings → This computer. Or set `NIGHTSHIFT_WEB_REQUESTS_PRIVATE_NETWORK=on`.
- No web request reaches a link-local or a cloud metadata address, on any computer.

## Advanced: the terminal

Each step above has a command too. See [Terminal and MCP](Terminal-and-MCP.md).

- `nightshift join <host-address>` pairs this computer with a Host. `nightshift pair <code>` on the Host allows it.
- `nightshift merge` shows what moves into your Personal on the Host, before it moves.
- `nightshift join <host-address> --guest` joins the Host of another person. A guest Host never gets your Personal.
- `nightshift leave` ends the pairing. The Host keeps everything. This computer keeps its own Personal. Night Shift pauses its schedules, because the Host still runs them. When you join the same Host again, the schedules that you did not change are on again.
