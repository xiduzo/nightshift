# Get started

This page takes you from nothing to your first run. It takes about 15 minutes.

## What you need

- A Mac with Apple silicon, or a Linux computer (x64).
- An account for Claude or ChatGPT. Night Shift installs the agent, Claude Code or Codex, for you.

You do not need to write code. A basic knowledge of the terminal helps for some nodes, such as a shell command.

## 1. Install the desktop app

1. Open the [nightly release](https://github.com/xiduzo/nightshift/releases/tag/nightly).
2. Download the file for your computer: macOS (Apple silicon) or Linux (x64).
3. Install the app and open it.

On macOS, the first start needs one extra step, because the app is not signed yet:

1. Open **System Settings > Privacy & Security**.
2. Choose **Open Anyway**.

The app updates itself. It downloads an update in the background, but it never restarts by itself, because a restart stops the runs in progress. When no run needs it, choose **Restart to Install** in the app menu.

## 2. Follow Get started on Home

Until you have an agent and a project, Home shows a **Get started** card. It lists four things. Each has one button. **Later** hides the card until you open Night Shift again.

1. **Set up an agent.** Choose **Set up** next to **An agent**. Night Shift installs Claude Code or Codex, and you sign in in your browser. See [Set up an agent](Agents-and-profiles.md#set-up-an-agent).
2. **Choose a model that decides.** This step is optional. Some flows let a small model pick the next step. **A model on this computer** needs no account. **TypeSafe Jev** needs a key. **Choose later** skips the step. See [Deciders](Flows-and-nodes.md#deciders).
3. **Check that the agents answer.** Choose **Check now**. Night Shift asks each of its own agents one small question. A row that fails says what happened and how to fix it.
4. **Add a project.** Choose **Add project**. Then choose one of these:
   - **A folder** on your computer, for code, documents, or data.
   - **A repository from GitHub**, which Night Shift copies for you.
   - **No folder**, for work that needs no files, such as research. See [A project without a folder](#a-project-without-a-folder).

For a project with a folder, Night Shift asks two more things:

1. **Set up git** shows when the folder has no git. Night Shift uses git to give each run its own copy of the folder. Choose **Set up git**. Night Shift saves every file in a first commit. Your files do not change.
2. **Add the starter flows** is on. Keep it on. Then choose which of your agents runs each part of the [starter flows](Flows-and-nodes.md#starter-flows).

## 3. Run your first flow

Use the starter flow `scout-and-pick`. An agent finds candidates on a topic, you pick one, and another agent writes a report on it.

1. Open your project, then its **Flows** page.
2. Open `scout-and-pick`, and choose **Run**.
3. In **topic**, type something that you want to know more about, for example "podcast hosting services" or "electric cargo bikes".
4. Choose **Start**. The run page opens, and shows each step live.
5. Wait for the question in your **Inbox**. Night Shift asks which candidate gets a report.
6. Pick one, and choose **Send**.
7. Read the report. When the run ends, the run page shows it. You also find it in **Knowledge**, under **Files**, in the `scout` folder.

You ran your first flow.

## Next steps

1. Read [How Night Shift works](How-Night-Shift-works.md) for the main words.
2. [Build your first flow](Your-first-flow.md): a news brief each morning.
3. When a flow does what you want, give it a schedule. See [Runs and schedules](Runs-and-schedules.md#schedules).

## A project without a folder

A project is a place for a body of work: its flows, schedules, knowledge, secrets, and runs. Its folder is optional. Choose **No folder** in **Add project** for work that needs no files of its own, such as research or outreach. You give it only a name.

To build its first flow, open the project's **Flows** page and choose **New flow**. Follow [Your first flow](Your-first-flow.md), or tell the agent in the chat what the flow must do. See [Build a flow with an agent](Flows-and-nodes.md#build-a-flow-with-an-agent).

- Each run starts in an empty folder of its own. The run page shows the files that the run wrote. See [The files of a run](Runs-and-schedules.md#the-files-of-a-run).
- To keep a value for the next run, use a variable with **Keep between runs**, or the project's [knowledge](Knowledge.md).
- It has no starter flows, no branches, and no **Start from**.
- A step that needs a folder fails here, such as a GitHub kit or a command that runs git. You cannot add a kit that needs a folder. The editor marks each such step with a warning.
- A Host needs no copy of it. See [Computers and Hosts](Computers-and-Hosts.md#a-project-without-a-folder).

A project keeps its folder, or the lack of one. To give the work a folder later, add the folder as a new project.

## More agents and tools

**Your harnesses** in Settings has the same setup as Home: **Set up an agent**. It also lists the agent CLIs (`claude`, `codex`, `opencode`, `pi`) and the tools (`gh`, `acli`) that it finds on this computer. Choose **Add profile** or **Add tool** for each one that you want. See [Agents and profiles](Agents-and-profiles.md).

## Other ways to run Night Shift

| Way | For |
| --- | --- |
| **The desktop app** | Your own computer. This page. |
| **The Docker image** | A Host on a server, which runs your schedules while your laptop sleeps: `ghcr.io/xiduzo/nightshift:nightly`. See [Computers and Hosts](Computers-and-Hosts.md). |
| **From source** | Work on Night Shift itself, or run your flows from a clone. See below. |

### Run from source

You need [Bun](https://bun.sh) 1.3 and git.

```bash
git clone https://github.com/xiduzo/nightshift.git
cd nightshift
bun install
bun run dev
```

The web UI opens on http://localhost:3001. The API runs on port 3000. You need no `.env` file to start.

| Command | Use it to |
| --- | --- |
| `bun run dev` | Work on Night Shift itself, with hot reload. It also starts the phone app in Expo. Data stays in `.nightshift-dev/`. |
| `bun run night` | Run your real flows from a stable build that does not reload. Data stays in the OS app data folder. |
| `bun run dev:desktop` | Start the desktop app. |
| `bun run build:desktop` | Build the desktop app. The installers go to `apps/desktop/artifacts/`. |

The OS app data folder is `~/Library/Application Support/Night Shift` on macOS. On Linux it is `$XDG_DATA_HOME/nightshift`, else `~/.local/share/nightshift`.

Run your real flows with `bun run night`, and change Night Shift in a separate git worktree. A code change then never reloads Night Shift in the middle of a run.

## Usage data

A released build of Night Shift (the desktop app and the Docker image) sends anonymous usage events to the Night Shift team. A run from source sends nothing. The events are a closed list, with no names, paths, prompts, or file contents.

To stop the usage events, do one of these:

- Use the switch in Settings.
- Set `NIGHTSHIFT_USAGE=off` or `DO_NOT_TRACK=1`.

[Usage data](https://github.com/xiduzo/nightshift/blob/main/docs/usage-data.md) lists every event and field.
