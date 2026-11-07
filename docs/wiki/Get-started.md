# Get started

## Pick a way to run Night Shift

| Way | For |
| --- | --- |
| **The desktop app** | Your own computer. Download it from the [nightly release](https://github.com/xiduzo/nightshift/releases/tag/nightly): macOS (Apple silicon) or Linux (x64). It updates itself. |
| **The Docker image** | A Host on a server: `ghcr.io/xiduzo/nightshift:nightly`. See [Computers and Hosts](Computers-and-Hosts.md). |
| **From source** | Work on Night Shift itself, or run nights from a clone. See below. |

Every way needs git, and at least one coding-agent CLI that you are logged in to, such as `claude`. Night Shift runs on macOS and Linux.

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
| `bun run night` | Run real nights from a stable build that does not reload. Data stays in the OS app data folder. |
| `bun run dev:desktop` | Start the desktop app. |
| `bun run build:desktop` | Build the desktop app. The installers go to `apps/desktop/artifacts/`. |

The OS app data folder is `~/Library/Application Support/Night Shift` on macOS. On Linux it is `$XDG_DATA_HOME/nightshift`, else `~/.local/share/nightshift`.

Run nights with `bun run night`, and change Night Shift in a separate git worktree. A code change then never reloads Night Shift in the middle of a night.

## Your first run

1. **Add a project.** Choose its folder, or copy a repository from GitHub. Leave **Add the starter flows** checked. The seven [starter flows](Flows-and-nodes.md#starter-flows) arrive in the project. If you have agent profiles, choose one for each agent that the flows name. Night Shift keeps the flows outside your repository.
2. **Add your agents.** The Agents page shows the agent CLIs (`claude`, `codex`, `opencode`, `pi`) and tools (`gh`, `acli`) that it finds on this computer. Choose **Add profile** or **Add tool** for each one you want. See [Agents and profiles](Agents-and-profiles.md).
3. **Open `implement-and-check`.** Set the check to your project's test command.
4. **Start a run** with a small task. Follow the transcript of each step live.

When the run works, schedule it for the night. See [Runs and schedules](Runs-and-schedules.md).

## Usage data

A released build of Night Shift (the desktop app and the Docker image) sends anonymous usage events to the Night Shift team. A run from source sends nothing. The events are a closed list, with no names, paths, prompts, or code.

To turn usage off, do one of these:

- Turn it off in Settings.
- Set `NIGHTSHIFT_USAGE=off` or `DO_NOT_TRACK=1`.

[Usage data](https://github.com/xiduzo/nightshift/blob/main/docs/usage-data.md) lists every event and field.
