# Delta and DeltaDB: what they could do for Night Shift

**Status:** Assessment, 2026-10-30. No work scheduled. Read with
`next-phase-2026-11.md` §3.3 (knowledge folder) and §4.1 (export).

## 1. What Delta is

Delta is a collaborative agent workspace from Zed Industries, in public beta.
People and agents work in shared threads. Its store, DeltaDB, records every
edit between Git commits together with the conversation behind it: "Git
keeps the commits; DeltaDB keeps everything in between." Each edit is a
delta with an author (person or agent) and a place in a causal graph.
Messages, comments and file changes sit in one history, so a line of code
leads back to the message that produced it.

The parts that matter here:

| Part | What it does | Notes |
| --- | --- | --- |
| Delta app | Threads with teammates and agents, on desktop, web and phone | Account needed. Models through your own keys or subscriptions |
| Delta CLI (beta) | `thread create/append/watch/search/show/query/share`, `worktree create/mount` | JSON output, scriptable. Starts the desktop app in the background when it needs it |
| Plugin contract (v8) | An agent's session becomes a thread: `thread append` takes ACP v2 updates as JSON Lines; `worktree mount --existing-checkout` uploads and syncs the checkout | Idempotent by `--source` and `--external-id`. Offline recording with `--acknowledge local` |
| Claude Code plugin | `zed-industries/delta-claude` records interactive Claude Code sessions | Does not support print mode (`claude -p`) or SDK sessions yet |
| Roadmap | Delta MCP server, repository-level context, Codex and pi plugins, agent-to-agent hand-off | No dates |

Where the data goes: the backend runs on Cloudflare (R2, Durable Objects,
D1). A shared or synced thread uploads the repository contents and Git
history, untracked files included, and the whole conversation. Zed says it
will open-source DeltaDB, with a paid service beside it. There is no
self-hosting today and no local-only mode.

## 2. Per run: a night as a Delta thread

**The idea.** Each run, or each Agent step, becomes a Delta thread. In the
morning a teammate opens it, reads why each change was made and comments on
a line before anything merges. `delta thread search --edited-path` later
answers "which night touched this file, and why".

**How it would work.** Night Shift runs `claude` headless, so the Delta
plugin does not see its sessions. Night Shift would be its own plugin: for a
run, `thread create --source nightshift --external-id <runId>`, then
`thread append` with the step's events translated to ACP v2 updates (the ACP
harness already speaks them), and a `worktree mount` of the run's copy
while it runs. That is an export sink, the same shape as the OpenTelemetry
export of §4.1.

**What Night Shift already has.** The run view shows each step's
transcript, and since main a8efe83f each step's changed files. The gap to
Delta is the anchor: Night Shift knows which step changed a file, not
which message or tool call changed which lines, and a person cannot comment
on a line.

**What stands in the way.**

- Local first (§1 of the plan): knowledge and monitoring work with no
  account and no network. Delta needs both.
- Client code. A synced thread uploads the whole checkout and the
  conversation to a third party. Many client projects cannot allow that.
- A beta contract (v8 now) and a CLI that wakes a desktop app. Unknown on a
  Host container.

**Verdict: later, and only as an opt-in sink.** Build the export vertical
of §4.1 with more than one sink in mind. Revisit after DeltaDB is open
source or self-hostable, and only for projects that may leave the
computer.

## 3. Per project: Delta as a knowledge source

Delta is not a knowledge store. It is a source of one kind of knowledge:
the reasons behind past changes, from the team's own interactive sessions.

- **Now, if a team uses Delta:** a sync kit `knowledge/delta` that runs
  `delta thread search` and `delta thread show --format summarize` and
  writes markdown into the project's knowledge folder. It fits phase 1
  (files and a CLI). Avoid `delta thread query`: it sends transcripts to a
  model and is not repeatable.
- **When Delta ships its MCP server:** a person attaches it to a node as a
  Connection. Night Shift needs no change for that.

**Verdict: a kit, written when a project actually uses Delta.**

## 4. What to take from Delta, with no dependency

These fit the plan and need no account:

1. **Past runs are knowledge.** Delta's strongest feature is search over
   past work with the reasons kept. Night Shift has the same material: every
   run's transcript, report and learnings. Phase 2 (§4.3) should index
   accepted learnings and run reports next to the knowledge folder, so
   `search_knowledge` also answers "how did an earlier night solve this".
2. **Anchor changes to the call that made them.** Record, per changed file,
   the tool call that wrote it (the Claude and Codex events already carry
   the path). The run view can then jump from a changed file to the moment
   in the transcript. A step-level list exists; this makes it precise.
3. **A run as one causal record.** Delta treats messages, comments and edits
   as one history. Night Shift's event log already is one. Gate answers and
   notes belong in it as first-class entries, so a later run can read why a
   person chose what they chose (input for §3.4 learnings).

## 5. Sources

- Delta: https://delta.dev/, https://delta.dev/deltadb
- CLI reference: https://delta.dev/docs/cli/get-started
- Plugin contract: https://delta.dev/docs/cli/build-a-plugin
- Claude Code plugin: https://delta.dev/docs/cli/claude-code
- Data storage: https://delta.dev/docs/privacy-and-security/data-storage
- Roadmap: https://delta.dev/roadmap
- Zed, "Software Is Made Between Commits": https://zed.dev/blog/introducing-deltadb
- The New Stack on the launch: https://thenewstack.io/zed-delta-github-alternative/
