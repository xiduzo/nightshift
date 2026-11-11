# Troubleshooting

Each entry says what you see, why, and how to fix it.

## Install

### macOS does not open the app

The macOS app is not signed yet. Open **System Settings > Privacy & Security**, and choose **Open Anyway**. Later updates install without this step.

### `nightshift: command not found`

A clone does not put `nightshift` on your PATH. Run `bun <clone>/apps/server/src/cli.ts`, or make an alias. See [Terminal and MCP](Terminal-and-MCP.md#get-the-command).

## Agents

### "Needs OpenCode 1.x. Version 2.x does not work yet."

Night Shift drives OpenCode 1.x only. Install an OpenCode 1.x build, and set its path on the Agents page.

### pi does not start

Night Shift needs pi 0.81 or later. Update pi.

### "This computer does not have this custom agent."

The flow names a custom agent that this computer does not have. Add it under Agents, or pick another agent on the node.

### An agent cannot commit or run a command when nobody watches

Its profile is in **Accept edits** or **Ask for each tool** mode. Those modes cannot run shell commands when nobody approves them. The flow editor warns about it. Set the profile to **Auto**. See [Permission modes](Agents-and-profiles.md#permission-modes).

### A step waits for a usage limit

You need to do nothing. The step waits for the reset, and continues the same session. See [Run policy](Runs-and-schedules.md#run-policy).

## Computers and Hosts

### A step waits for a computer that is offline

The node names a profile on that computer, and it has no backup that can take the step. Start the computer, or add a [backup](Agents-and-profiles.md#backups) on another computer. Without either, the step waits until the stop time.

### "Personal secrets do not work on the Host. Move it to the Space or the project."

A step on a Host never reads a Personal secret, also on your own Host. Move the secret to the Space or the project on the Secrets page. See [Secrets](Computers-and-Hosts.md#secrets).

### A flow shows "Unknown device"

The flow names a computer that left the Space. Open the node, and choose another profile or computer.

### The Host refuses to pair a computer

Another install of the same computer is online. One computer is one Device, and only one Night Shift at a time can be that Device. Quit the other install, then pair again.

### "Update Night Shift" for a project without a folder

The computer or the Host runs an older version of Night Shift. It cannot add a project without a folder, or run the steps of one. Update Night Shift there.

### A development install does not connect to the Host

By design, a development install (`bun run dev`) pairs and connects only with a Host on the same computer. To test against a remote Host, set `NIGHTSHIFT_DEV_LINK_HOST=true`.

## Schedules

### A schedule did not start

Night Shift starts a missed time only within the schedule's late window. The default is 15 minutes. If the Host was off for longer, Night Shift skipped the time and told you. Make the late window longer, or keep the Host on.

### The schedule says the Host has no copy of the project

A schedule's run starts on the Host, so the Host needs the project. A Host copies a project with a GitHub remote by itself. A project without a folder needs no copy. A private repository needs `gh` signed in on the Host. See [The Host copies your GitHub projects](Computers-and-Hosts.md#the-host-copies-your-github-projects).

## Knowledge

### Search finds by words only

Search by meaning needs Ollama and its model. The Knowledge page tells you when search by meaning stopped. Start Ollama, or open **Settings → Meaning search** and download the model. See [Search](Knowledge.md#search).

## Still stuck

[Open an issue](https://github.com/xiduzo/nightshift/issues). Tell what you did, what you saw, and the version of Night Shift.
