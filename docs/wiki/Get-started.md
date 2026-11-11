# Get started

## Pick a way to run Night Shift

| Way | For |
| --- | --- |
| **The desktop app** | Your own computer. Download it from the [nightly release](https://github.com/xiduzo/nightshift/releases/tag/nightly): macOS (Apple silicon) or Linux (x64). It updates itself. |
| **The Docker image** | A Host on a server: `ghcr.io/xiduzo/nightshift:nightly`. See [Computers and Hosts](Computers-and-Hosts.md). |
| **From source** | Work on Night Shift itself, or run your flows from a clone. See below. |

Every way needs git, and at least one agent CLI that you are signed in to, such as `claude`. Night Shift runs on macOS and Linux. When you add a project and git is missing, Night Shift helps you install it.

The macOS app is not signed yet. The first time you open it:

1. Open **System Settings > Privacy & Security**.
2. Choose **Open Anyway**.

Later updates install without this step. The app downloads an update in the background. It never restarts by itself, because a restart stops the runs in progress. Choose **Restart to Install** in the app menu when no run needs it.

## Run from source

You need [Bun](https://bun.sh) 1.3.

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

## Your first run

1. **Add your agents.** The Agents page shows the agent CLIs (`claude`, `codex`, `opencode`, `pi`) and tools (`gh`, `acli`) that it finds on this computer. Choose **Add profile** or **Add tool** for each one you want. See [Agents and profiles](Agents-and-profiles.md).
2. **Add a project.** Choose its folder, or copy a repository from GitHub. A project can hold any files: notes, documents, data, or code.
3. **Set up git if Night Shift asks.** Night Shift keeps the history of your project folder with git, and gives each run its own copy. For a folder without git, choose **Set up git**. Night Shift saves every file in a first commit. Runs do not change the files in your folder.
4. **Keep the starter flows.** Leave **Add the starter flows** checked. Then choose which of your agents runs each part of the [starter flows](Flows-and-nodes.md#starter-flows). Night Shift keeps the flows outside your project folder.
5. **Start `scout-and-pick`** with a topic that you want to know more about, for example "podcast hosting services" or "PDF libraries for Bun". An agent searches the project's knowledge and the web for candidates.
6. **Pick one in your inbox.** Night Shift asks you when it needs you. Here it asks which candidate gets a report. You can also follow each step live on the run page.
7. **Read the report.** Another agent writes it into the project's knowledge. Open **Knowledge**, then **Files**, and look in the `scout` folder.

When a flow does what you want, give it a schedule. See [Runs and schedules](Runs-and-schedules.md).

## Usage data

A released build of Night Shift (the desktop app and the Docker image) sends anonymous usage events to the Night Shift team. A run from source sends nothing. The events are a closed list, with no names, paths, prompts, or file contents.

To turn usage off, do one of these:

- Turn it off in Settings.
- Set `NIGHTSHIFT_USAGE=off` or `DO_NOT_TRACK=1`.

[Usage data](https://github.com/xiduzo/nightshift/blob/main/docs/usage-data.md) lists every event and field.
