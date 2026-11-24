# Troubleshooting

Each entry says what you see, why, and how to fix it.

## First, ask why

When a run fails or ends early, start here:

1. Open the run.
2. Choose **Ask why**. An agent reads the run, and tells you what went wrong and what you can do. It changes nothing.
3. Open the step that failed. Its transcript shows what the agent or the command did.

When the editor shows a problem, open **Issues** at the bottom of the canvas. It lists the errors and the warnings of the flow. Fix the errors before you run the flow.

## Flows

### The run ends after a step, but the flow has more steps

The step ended on an outcome without an edge. An outcome without an edge ends the run there. The editor warns about it under **Issues**. Connect the outcome to the next node, or add an End node to it with a clear message.

### A template is empty, or the editor warns about a field

A template names the node by its id, not by its title. Check the id of the node in the panel on the right, and check the field name. For example, `{{planner.data.taks}}` has a typo. See [Data between nodes](How-Night-Shift-works.md#data-between-nodes).

### "This flow has errors. Fix them, or the schedule cannot start it."

A schedule cannot start a flow with errors. Open the flow, and fix each error under **Issues**.

## Install

### macOS does not open the app

The macOS app is not signed yet. Open **System Settings > Privacy & Security**, and choose **Open Anyway**. Later updates install without this step.

## Agents

### Setup is not available

**Your harnesses** in Settings has no **Set up an agent**, or the page of an agent says where to set it up. Night Shift installs an agent only on the computer that runs it.

- "Open Night Shift on that computer to set up an agent there." You use Night Shift from another computer. Open Night Shift on the computer that runs the agent.
- "Night Shift runs in a container here, so an install would not last." Add the agent to the image of your Host. See [Add your tools](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/README.md#add-your-tools).
- "Night Shift can set up an agent on macOS and Linux only." Install the agent yourself. Then add it in Settings, under **Your harnesses**.

### The install did not finish

Open **Details** under the problem. It shows the last messages of the installer. Check the internet connection of this computer, then choose **Install** again.

The problem says that the agent installed, but Night Shift cannot find it. Quit Night Shift and open it again. Then choose **Sign in**.

### The sign-in did not finish

The setup says that the agent is not signed in yet, or that the sign-in took too long. Choose **Sign in** again, and finish the sign-in in your browser. If the page shows a code, paste it in the **Code** field. **Cancel** stops a sign-in that waits.

### The local decider did not finish

- "Ollama did not start." Open the Ollama app, or start Ollama yourself. Then choose **Use Local** again.
- "The download of llama3.2:latest stopped." Check the internet connection of this computer. Then choose **Use Local** again. The download continues from where it stopped.
- "Night Shift could not install Ollama." Open **Details** under the problem for the last messages of Homebrew. Or download Ollama from its page, then choose **Check again**.

### "The model … is not on this computer."

A Decision or a Value runs on an Ollama model that this computer does not have. Open the Model Profile of the step in Settings, under **Models**, and choose **Download**. Then run the step again.

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

### A flow or a run says "older version of Night Shift"

An older Night Shift made it, and this one does not read it. Nothing is lost:

- **A flow.** You cannot change or run it. Delete it, or make a new flow with another name.
- **A run.** You can read its steps and costs. Start the flow again to run it.
- **A flow file.** You cannot import it. Make the flow again.

### The Host refuses to pair a computer

Another install of the same computer is online. One computer is one Device, and only one Night Shift at a time can be that Device. Quit the other install, then pair again.

### "Update Night Shift" for a project without a folder

The computer or the Host runs an older version of Night Shift. It cannot add a project without a folder, or run the steps of one. Update Night Shift there.

## Runs

### A run ended without its report file

The End node reads its report from a file, but it did not get a text file from that path. The run page says why. Check these:

1. The step writes the file inside the folder the run works in. The End node uses the same path, for example `reports/{{topic}}.md`.
2. The file is text, such as Markdown. Night Shift does not read a PDF or an image as a report.
3. In a project without a folder, the step that writes the file runs on the same computer as the run. Each computer has its own folder of the run.
4. The computer with the file stays on until the run ends. "Could not read the report file on" a computer means that it was offline or did not answer. Night Shift waited for it as long as the **Network** limit of the [run policy](Runs-and-schedules.md#run-policy).

"Update Night Shift" in the message means that the computer runs an older version. Update Night Shift there.

### "Update Night Shift there to run a test."

The computer that keeps this Space runs an older version of Night Shift. It cannot run a test with pinned outputs or skipped nodes, so nothing starts. Update Night Shift on that computer. Or start the run without pins and skips.

A test run also moves only to a computer that can run one. A move to a computer with an older version says "runs an older version of Night Shift".

## Schedules

### A schedule did not start

Night Shift starts a missed time only within the schedule's late window. The default is 15 minutes. If the Host was off for longer, Night Shift skipped the time and told you. Make the late window longer, or keep the Host on.

### The schedule says the Host has no copy of the project

A schedule's run starts on the Host, so the Host needs the project. A Host copies a project with a GitHub remote by itself. A project without a folder needs no copy. A private repository needs `gh` signed in on the Host. See [The Host copies your GitHub projects](Computers-and-Hosts.md#the-host-copies-your-github-projects).

## Knowledge

### Search finds by words only

Search by meaning needs Ollama and its model. The Knowledge page tells you when search by meaning stopped. Start Ollama, or open **Settings → Night Shift's agents** and click **Download** in the **Search** table. See [Search](Knowledge.md#search).

## From source

### `nightshift: command not found`

A clone does not put `nightshift` on your PATH. Run `bun <clone>/apps/server/src/cli.ts`, or make an alias. See [Terminal and MCP](Terminal-and-MCP.md#get-the-command).

### A development install does not connect to the Host

By design, a development install (`bun run dev`) pairs and connects only with a Host on the same computer. To test against a remote Host, set `NIGHTSHIFT_DEV_LINK_HOST=true`.

## Still stuck

[Open an issue](https://github.com/xiduzo/nightshift/issues). Tell what you did, what you saw, and the version of Night Shift.
