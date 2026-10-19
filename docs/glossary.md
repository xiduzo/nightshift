# Night Shift Glossary

The ubiquitous language of Night Shift. Docs, the UI, and code use these terms. One name for one thing.

A Flow speaks only in Nodes, Edges, Steps, and Gates. A method's own language (for WTF: Epic, Feature, Trace) lives in the prompts and skills of a Flow, never in the engine.

## Actors

| Term | Meaning | Source |
|------|---------|--------|
| Developer | Owns a clone of the repo and the coding-agent CLIs. Draws Flows, starts Runs, and answers Gates. In local mode, the only user. | PLAN §1 |
| Person | A user account (Better Auth's user). The Person who owns this computer's Device is signed in for you: a request from this computer without a session of its own acts as them. | Devices, slice 2 |
| Member | A Person in a Space, with a role: owner, admin, member or viewer. The role says what they may do there: start Runs, answer Gates, add Projects. A viewer only reads. Owners and admins invite people, change roles and remove Members on the Members page; only an owner deletes a Space. A removed Member no longer sees the Space. | Devices, slice 2, slice 6 |
| Host admin | The first Person on a Host: on this computer, the Person who owns it. The admin plugin's `admin` role, not a role in a Space. | Devices, slice 6 |
| Invitation | An offer to join one Space with a role, for one email. It is also the account: a Host takes new people by invitation only, so the person makes their account from the invitation's link (`/invite/<id>`), then joins. Night Shift sends no email: the Members page shows the link to copy. It works for seven days, until it is accepted or canceled. A personal Space takes none. | Devices, slice 6 |

## Objects

| Term | Meaning | Source |
|------|---------|--------|
| Space | What is shared, and with whom: Projects, their Runs and Gates, and the Members. A Better Auth organization. Every Person has a personal Space ("Personal") that nobody can be invited to, and everything starts there. Every row of a Project, Clone, Run, Step, Session or Event carries its Space; a person always works in one Space at a time (the session's active Space). | Devices, slice 2 |
| Project | A repository, by its remote: the normalised `origin` (`github.com/acme/app`), so its ssh and https URLs are one Project. Its folders are its Clones. A repository without a remote is a Project on one Device only. | Devices |
| Clone | A Project's repository on one Device, at a path. A Device has at most one Clone of a Project. Adding a folder whose `origin` names a known Project makes a Clone of it, not a second Project. | Devices |
| Device | A computer that runs Night Shift, with its own database. One row of the `device` table is this computer: made on the first start, with a random id that never changes and the host name as its name. | Devices |
| Walker | The Device that walks a Run and writes its Events. Today every Run's Walker is this computer. | Devices |
| Owner | The one Device that writes a row. Sync never merges two writers of one row: a Run's rows and Events are its Walker's, a Clone is its Device's. | Devices |
| Replica | A Device's own database: everything it may see, as far as it has synced. Today, the only one. | Devices |
| Device document | A Device's configuration as one Yjs document, `device:<id>`: its Agent Profiles, CLI Tools, Connections, Settings, and its facts (harnesses, programs, secret names, Clones). Its Device is its Owner: it applies edits and saves the document in its Replica. Syncs at `/sync`, to its owner only: their sessions, and their other Devices on the Device's Home Host. Never holds a secret value. | Devices, slice 3 |
| Host | A Device with "Be a Host" on: other Devices pair with it and connect to it. It has addresses (`https://` names, in the order to try them). It listens on this computer only (`127.0.0.1`) until one of them is `https://`. It records each paired Device and keeps it online while its Link answers. Not an authority over a Device's data. | Devices, slice 4 |
| Home Host | The one Host that keeps a Device's Device document. A Device has at most one. Its other Devices of the same owner open the document there. | Devices, slice 4 |
| Guest Host | Any other Host a Device paired with: it gets the shared Spaces of the Device's owner there, never the Device document. | Devices, slice 4 |
| Pairing | Joining a Device to a Host: Devices → Join a Host (or `nightshift join <host>`) shows a code, a Person signed in on the Host enters it under Devices → Pair a device and allows it (or runs `nightshift pair <code>` on a Host without a screen), and the Device gets its Device key. Device authorization (RFC 8628). | Devices, slice 4 |
| Way out | How a Host's `https://` address reaches it: its LAN name with its own certificate, a tailnet (Tailscale Serve, Funnel), a public server behind a proxy, or an outbound tunnel. A deployment choice; Night Shift ships none (`docs/deploy/`). | Devices, slice 7 |
| `nightshift` | Night Shift in one file, for a computer without a screen: the daemon, its web UI and its migrations. `nightshift serve`, `join`, `pair`. | Devices, slice 7 |
| Device key | What a paired Device signs in with on a Host: an API key of the Person who allowed the pairing, with the Device's id. Hashed on the Host; on the Device, in the keychain or a file only its user can read. Narrower than its Person: `sync`, `relay`, `archive`. Expires after days without use; "Remove access" deletes it. The UI says "access", not "key". | Devices, slice 4 |
| Link | A Device's outbound connection to one Host (a port; `httpsLink` is its adapter): oRPC with the Device key and the relay's WebSocket to the same address. It tries the Host's addresses in order, keeps the first that answers, and sends a heartbeat. The Host never calls into a Device. | Devices, slice 4 |
| Space document | A Space's definitions as one Yjs document, `space:<id>`: its Projects (name, remote, removed), which Devices have a Clone of each (never the path), and a mirror of its Members. Members read it at `/sync`; they change it only through Night Shift's actions (add, rename, remove, move a Project), which check their role and log an event. The Replica's project rows follow it. | Devices, slice 3 |
| Flow | A directed graph of Nodes and Edges, stored as `.nightshift/flows/<name>.json` in the Project's clone. | PLAN §2 |
| Node | One step of a Flow: Agent, Command, Tool, Decision, Value, Wait, or Subflow (`call` in the file). Its id is also its name in templates. | PLAN §3 |
| Agent Node | A Node that runs one Session on its Harness, with a prompt or a skill (with arguments), a model, an effort, and a permission mode. It names an Agent Profile for them, or sets them itself; a field it sets wins over the profile. The agent picks its Outcome in its Step Report, or a Checker picks it. | PLAN §3 |
| Agent Profile | A Harness, a model, an effort, a permission mode, CLI Tools and Connections under one name, defined once on the daemon (the Agents page). Agent Nodes name it in `profile`. A Run resolves it when it starts, so a later change reaches the next Run. A Flow that names a profile the daemon does not have refuses to start. | Agents |
| Command Node | A Node that runs one shell command in the Worktree. Its Exits map exit codes to Outcomes; without `exits`, 0 is `pass` and any other code `fail`. With `output: "json"`, what it prints is `data` for later Nodes; output that is not JSON ends on the catch-all Exit. | PLAN §3 |
| Exit | One Outcome of a Command Node: an exit code (0–255) and a name. The Exit without a code is the catch-all: any other code, a command that cannot start, or JSON that is not valid. New nodes start with 0 `success`, 1 `error`, and `other`. | Command exits |
| Checker | A decision model on an Agent Node (`checker`) that reads the Step Report after the Session and picks the Outcome, instead of the agent. | Agent checker |
| Decision Node | A Node that picks one of its Options, which is the Step's Outcome. Who picks is `by`: you (a Gate), a Rule, or a model (the Decider). Its prompt is the question for you, the brief for the model, or a note on the Rules. Later Nodes read `outcome` and `note`. | PLAN §3 |
| Tool Node | A Node that calls one tool of a Connection itself, with arguments from templates, and no model in the loop. The MCP leg of "flow + CLI + MCP", next to the Command Node. `pass` when the tool answers; `fail` when it reports an error, the Connection has no such tool, or does not answer. Later Nodes read `data` (the tool's structured answer, else the JSON its text holds) and `text`. Not a CLI Tool: that is a program an agent may run. | Tool node |
| Option | One of the things a Decision Node can pick, with a name, a description, and (for a Rule) `when`. Each Option has its own Edge. | PLAN §3 |
| Gate | A Decision decided by you: it waits in the Needs-you inbox with its question and its Options, and holds the Run with an Interrupt until you answer. It waits as long as it must. | PLAN §3 |
| Rule | A JSONata expression over the same values templates see (`build.data.tests_passed = true and check.exit_code = 0`). On an Option of a Decision decided by a rule, the first Option whose Rule holds is picked, and the one Option without a Rule is the default. On a Value Node made by a rule, the expression's result is the data. No model, no cost. | Decision, Value |
| Value Node | The twin of a Decision Node: a Decision picks a label, a Value makes `data` that matches its Output Schema. Who makes it is `by`: a Rule (an expression over the run's values) or a model (the Decider's chat model, held to the schema). `pass` with the data, or `fail` with why in `note`. Later Nodes read `data`, or a path into it. | Value |
| Wait Node | A Node that waits for a duration, a time, a command that passes, or a Signal, then ends `done`. Its `timeoutMinutes` ends it `timeout`. Its whole job is a Wait: it parks the Run and the wake continues it. | PLAN §3 |
| Signal | A name someone sends to a Run (`runs.signal`). A Wait Node that waits for that name ends `done`. A Run that does not wait for it refuses it. | PLAN §3 |
| Start Node | The Node a Run begins at. | Slice 2 |
| Input | A named value a Flow takes, like a function argument. The top-level Flow's Inputs are asked at start. | Slice 5 |
| Output | A named value a Flow returns to the Node that called it. | Slice 5 |
| Call Node | Shown as Subflow in the app. A Node that runs another Flow with its Inputs bound: once (`pass` or `fail`), or with `each` once per Item of a List (`done` or `halted`). Either way `stopped` at the stop time: an Edge on it leads to the Nodes that still run after the stop time. | PLAN §3 |
| Body Flow | The Flow a Call Node with `each` runs once per Item. Any Flow can be a Body Flow. | Slice 4 |
| Item | One element of the List of a Call Node with `each`: any JSON value, optionally with `id`, `title`, `dependsOn`, and `done`. | Slice 4 |
| Connection | An MCP server defined once on the daemon (the Agents page, under Tools). An Agent Profile or an Agent Node names it in `connections`. Holds `${NAME}` references, never secret values. | Connections |
| Secret | A value a `${NAME}` reads: from the system keychain (saved on the Agents page, under Secrets), else the daemon's environment. Never in a Flow file, the database, or the log. | Connections |
| Lease | The right of one daemon to write to a database. The daemon takes it at start, keeps it with a heartbeat, and gives it up on a clean stop. A second daemon on the same database refuses to start. Each acquisition has an Epoch one higher than the last. | Lease |
| Epoch | The number of a Lease acquisition. A daemon whose Epoch is no longer the Lease's lost it, and exits (self-fence). | Lease |
| Setting | A daemon-wide value changed on the Settings page and saved in the Device document. Unset, it reads the environment, then its default. A Flow's own policy wins over the Settings' policy. | Settings |
| List | The elements a Call Node with `each` runs over, read from a Source. | Slice 5 |
| Source | Where a Call Node with `each` reads its List, again before each Item: a JSON value, a command that prints JSON, or a glob of files. A tracker is a command on its CLI (`gh`, `glab`, `acli`); the engine knows none. | Slice 4 |
| Schedule | A Flow, its Inputs, a time, and a Stop Time: the daemon starts a Run from it. | Slice 7 |
| Trigger | What starts a Run: a person, or a Schedule. | Slice 7 |
| Item Branch | The branch one Item works on, on top of the last Item that finished. Together they form the Stack. | Slice 4 |
| Stack | The chain of Item Branches of one Call Node with `each`. The engine makes the branches; a flow opens pull requests on them with a CLI tool such as `gh`. | PLAN §5 |
| Stop Time | The time after which a Run starts no new Step. | Slice 4 |
| Outcome | How a Step ended: `pass`, `fail`, `needs-input`, an Agent Node's own outcome, or a Decision Option. | PLAN §3 |
| Edge | A link from a Node to the next Node, taken on one Outcome. | PLAN §2 |
| Max | How often a Run may take an Edge. Every loop needs an Edge with a Max. | Slice 2 |
| Retry Loop | An Edge back to an earlier Node, bounded by a Max. | PLAN §2 |
| Template Variable | A reference to a value in a prompt or command: a Node output, an Input, or a Run field, with an optional JSON path, for example `{{check.log_tail}}`, `{{item.parent.number}}`, or `{{run.branch}}`. | PLAN §3 |
| Output | A named value a Step leaves for later Nodes, for example `summary` or `exit_code`. | Slice 2 |
| Issue | One problem the validator finds in a Flow. A Flow with an error cannot run. | Slice 2 |
| Run | One walk of a Flow in its own Worktree, driven as one Thread. It keeps a copy of the Flow from its start. | Slice 2 |
| Quick Run | A Run of a one-node Flow made from a prompt, without a Flow file. | Slice 2 |
| Step | One visit of one Node in a Run. The graph node of that Node runs it; its facts are Events. | Slice 2 |
| Thread | The LangGraph thread of a Run. Its id is the Run's id, and it holds the Run's Checkpoints. | LangGraph |
| Checkpoint | The run state LangGraph writes after every Node, in the tables `lg_checkpoint` and `lg_write`: inputs, the stop time, outputs for templates, visit and edge counts, the cursors of Call Nodes with `each`, and the pending Step (a Wait with its streak, a parked Step, or an open Gate). The walk reads it; people read the Event Log. A finished Run keeps its latest Checkpoint only. | LangGraph |
| Interrupt | How a Thread parks: a Wait, an open Gate, or a Step that failed or was stopped. A resume answers it, and the Run continues at the same Node, at any depth. | LangGraph |
| Wait | A Step's sleep: on a usage limit or a network failure (Agent Nodes and Decisions decided by a model), or a Wait Node's own sleep, which is a Wait too. The Node's wait node holds it with an Interrupt until a wake time, or for a Signal; the wake continues the same Step. | LangGraph |
| Visit | The count of a Step among the Steps of the same Node: 1 for the first. | Slice 2 |
| Session | One harness session of an Agent Step. A resumed Step has more than one. | Slice 1 |
| Harness | A coding-agent CLI that runs Sessions on this machine, with its own login, through a TanStack AI harness adapter: `claude-code` (Claude Code), `opencode` (OpenCode, a 1.x build), or `codex` (Codex). Added on the Agents page; an Agent Profile or an Agent Node names one. | Slice 8 |
| MCP Server | A tool server an Agent Node adds to its Session, next to the Harness's own: a local command (stdio) or a URL. Set on the Node, it is for that Node only. The editor shows MCP Servers, Connections and CLI Tools together as the Node's tools. | Slice 8 |
| Environment Reference | `${NAME}` in an MCP Server's env values or headers. The daemon puts in its environment variable `NAME` when the Step starts, so secrets stay out of Flow files. | Slice 8 |
| Step Report | The Outcome, summary, and optional data an agent reports at the end of its Session. | PLAN §3 |
| Output Schema | A JSON Schema for the data of an Agent Node's Step Report or a Value Node's value. The editor builds it from fields (text, number, yes or no, choice, list, object). The engine checks the data against it. | Slice 6 |
| Starter | A small Flow in `examples/starters/` to copy into a Project. | Slice 6 |
| Transcript | The structured record of a Step: agent messages, tool calls, and command output, on disk. | Slice 1 |
| Worktree | A git worktree in a sibling directory of the clone, used by one Run. | Slice 1 |
| Device | A computer that runs Night Shift. In code, the port a Step body uses to touch a computer (`packages/engine/src/device/`): it reports its Capabilities (harnesses, connections, CLI tools, programs, decider) and runs Sessions, commands, Tool calls, decisions and Worktrees. The step runner asks for the Step's Device once per Step; `StepStarted` names it. Today every Step runs on this computer (`localDevice`). | Devices, slice 1 |
| Event | One appended record of a fact that changed. Its identity is its Walker and its number among that Walker's Events (`walker_seq`); `seq` is only the order it landed in this Replica. | Slice 1 |
| Event Log | The append-only list of Events: the read model. Run status is derived from it, never from a Checkpoint. | Slice 1 |
| Run Bundle | One Run exported as its own SQLite file: its rows, its Events, and its Transcripts, in the daemon's table names. Secret values are masked. | Run export |
| Run Log | The daemon's copy in memory of each Run's Events. Every append goes through it, and it keeps an Event only after the database has it. | Run state |
| Run Policy | The rules for retries, rescue, blocked propagation, network grace, usage-limit waits, the stop time, and resume after a restart. | PLAN §2 |
| Needs-you inbox | The list of open Gates. | PLAN §3 |
| Decider | The TanStack AI decision model behind a Decision decided by a model: TypeSafe Jev by default, or Jev on OpenRouter, OpenAI Decisions, Ollaya. Its API key is a Secret. Jev on OpenRouter and OpenAI Decisions also have a chat model, so they can make a Value; TypeSafe and Ollaya only decide. | PLAN §2 |
| CLI Tool | A program on this computer, by its name (`gh`, `aws`), defined once on the daemon (the Agents page, under Tools). An Agent Profile or an Agent Node names it in `clis`: its agent may run it without a prompt. A Flow that names one the daemon does not have, or that the computer cannot find, refuses to start. An Agent Node can also name programs for itself only in `nodeClis`: not defined on the daemon, but the computer must find them. Not a Tool Node: a CLI Tool is a program an agent runs; a Tool Node calls one MCP tool of a Connection itself. | CLI tools |

## Run status

| Term | Meaning |
|------|---------|
| running | A Step runs, or the Run is between Steps. |
| waiting | A Gate waits for a person in the Needs-you inbox. |
| sleeping | A usage limit or a network failure: a timer continues the same Session. |
| finished | The Run reached `pass` or a Decision Option with no Edge left to take. |
| stopped | A person stopped the Run. |
| failed | A Step errored, a `fail` or `needs-input` had no Edge, or a Retry Loop hit its Max. |
| interrupted | The daemon stopped while a Step ran. The next daemon resumes it on its own a few seconds after it starts, unless its end reason says why not. |

## Verbs

| Term | Meaning | Source |
|------|---------|--------|
| draw | Edit a Flow in the editor. | PLAN §1 |
| validate | Check a Flow and list its Issues. | Slice 2 |
| start | Begin a Run of a Flow. | Slice 1 |
| walk | Run the Steps of a Flow one after another, following Edges. LangGraph drives the walk, one Node per super-step of the Thread. | Slice 2 |
| report | End a Session with a Step Report. | Slice 2 |
| stop | Abort the running Step and end the Run as stopped. | Slice 1 |
| park | Hold a Thread at an Interrupt: a Wait, a Gate, or a Step that failed or was stopped. | LangGraph |
| resume | Continue a stopped, failed, or interrupted Run at its last Node. A person resumes, or the daemon after a restart. The Thread answers its Interrupt, or runs the Node the daemon left pending again. | Slice 1 |
| take over | Hand a Session to a person with its Harness's resume command, for example `claude --resume <id>`. | Slice 1 |
| retry | Take a Retry Loop back to an earlier Node. | Slice 2 |
| rescue | Retry a Node with a stronger model. | PLAN §2 |
| resolve | Answer a Gate with one of its Options. | PLAN §3 |
| block | Skip an Item because an Item it waits on failed. | Slice 4 |
| halt | End a Call with `each` early because a Body Flow ended on a halt label. | Slice 4 |
| sleep | Wait on a timer after a usage limit or a network failure, or because a Wait Node says so. | Slice 4 |
| wake | End a sleep and continue the same Step: the timer, a person, or a Signal. | Slice 4 |
| signal | Send a Signal to a Run. | PLAN §3 |
| self-fence | Exit at once, writing nothing more, because the daemon lost its Lease to another daemon. Exit code 3. | Lease |

## Events

| Term | Meaning |
|------|---------|
| ProjectAdded | A clone became a Project. |
| ProjectRemoved | A person removed a Project. Its Runs and Events stay. |
| ProjectRestored | A removed Project's clone was added again. |
| CloneAdded | A folder became a Project's Clone on a Device: its `origin` named a known Project, or the Clone moved to a new folder. |
| ProjectRenamed | A person gave a Project a new name. |
| ProjectMoved | A person moved a Project, with its Clones, Runs and Events, from one Space to another. |
| MemberJoined | A Person joined a Space with a role: they accepted an Invitation, made the Space, or were added. Names who did it. |
| MemberRoleChanged | A Member got another role, and who changed it. |
| MemberRemoved | A Person is no longer a Member of a Space, and who removed them. |
| RunStarted | A Run began, with its copy of the Flow, and the Person who started it (none for a Schedule). |
| WorktreeCreated | A Worktree was created for a Run. |
| RunResumed | A person resumed a Run, or the daemon did after a restart (`by: "daemon"`). |
| StepStarted | A Step began a Visit of a Node. |
| StepReopened | A resume continued an Agent Step's Session in place. |
| StepEnded | A Step ended with an Outcome and its Outputs. |
| SessionStarted | A harness Session began for an Agent Step. |
| HarnessSessionAssigned | The Harness reported its own session id. |
| SessionEnded | A Session ended, with its cost. |
| EdgeTaken | The Run followed an Edge to the next Node. |
| StopRequested | A person asked to stop the Run. |
| GateOpened | A Gate put its question in the Needs-you inbox. |
| WaitStarted | A Step began a Wait: why, until when (none for a Signal with no timeout), and which Signal. |
| WaitEnded | The Wait is over: the timer, a person, or a Signal. |
| RunEnded | The Run finished or failed, with the reason. |
| ScheduleFired | A Schedule came due and started its Run, or failed to start it. |
| ScheduleSkipped | A Schedule came due but did not start: too late, or its previous Run still runs. |
