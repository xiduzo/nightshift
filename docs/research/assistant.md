# Agents inside Night Shift

**Status, 2026-10-26:** built on `feat/assistant`, except where noted.

- **Built:** the field helpers in the inspector and the flow settings (4.2:
  a "Suggest …" button for the prompt, output fields, variables, outcomes,
  options, rules, an expression, a command, what a checker checks, tool
  arguments, the description and the inputs; inventory in 4.2.1), the chat beside the canvas that
  proposes a flow and shows it on the canvas (section 3), "Ask an agent why"
  on a run that did not finish (4.1), `nightshift mcp` (section 5), and the
  "Profile for help" setting. Each runs read only on the agent the person
  picks (section 3.5): the profile for help, another Agent Profile with
  overrides, or a harness, model and effort.
- **Verified live** in a browser with Claude Code on Haiku (2026-10-26):
  every helper, a proposal through Show on canvas, Apply, Undo and Save, and
  "Ask an agent why" on a failed run. The project had no change afterwards
  except the saved flow file.
- **Not yet:** chat threads live in the memory of Night Shift only: a
  restart forgets them (question 2). Codex and OpenCode are not tested live
  as the assistant. Profile suggestions (4.3) and the flow that builds flows
  (4.4) are not built.

How Night Shift can use coding agents to help a person build flows and set
up agents, not only to run them. The main idea is a chat helper in the flow
editor that drafts and changes a flow with you, grounded in the project's own
code.

## 1. Constraints from what is already decided

- **No new model provider.** VISION puts "running models without a harness
  CLI, except a Decision node's decider" out of scope. So the helper is a
  **harness session** on one of the person's own Agent Profiles: their Claude
  Code, Codex, OpenCode or pi login, on their computer. Local first holds.
- **The engine decides, the model advises.** At run time a model never
  changes the graph. That stays true: the helper only works at **design
  time**, and it only **proposes**. A person accepts each change, and only a
  save writes the flow file.
- **The flow is the method.** The helper knows the flow schema, not WTF or any
  other method. It learns the method from the project (its skills, its
  AGENTS.md, its scripts).
- **Layers and copy rules** of `STRUCTURE.md` and `AGENTS.md` apply. In the UI
  the helper never says "session", "harness" or "tool bridge".

## 2. What already exists to build on

| Piece | Where | What it gives the helper |
| --- | --- | --- |
| Harness sessions with resume | `packages/agents/src/port/types.ts` (`resumeSessionId`) | A multi-turn chat: each message is one more turn of the same session. |
| The shared MCP tool bridge | `packages/agents/src/session/tool-bridge.ts` | A way to give the session Night Shift's own tools, as `report_step` and `save_artifact` already do. |
| Step report with an output schema | `packages/agents/src/session/step-report.ts` | One-shot structured answers ("fill this field") without new plumbing. |
| Flow schema and validator | `@nightshift/flows` (`flowSchema`, `validate/`) | The helper checks its own proposal and fixes the issues before you see it. |
| Flows API | `packages/api/src/flows/router.ts` (`get`, `map`, `save`) | Reads of the flows; the save stays the person's action. |
| Profiles, CLI tools, connections, skills | Agents page, `agents/src/skills`, `agents/src/tools` | What the helper may reference in a node, so it does not invent profile or skill names. |
| Transcript view with Markdown | run transcript in `apps/web` | The chat's message list. |
| The Decider | `agents/src/decider` | Cheap one-off picks where a harness is too heavy (optional, see 4.3). |

The gap is small: a set of **authoring tools**, one **API procedure** that
streams a chat turn, and a **panel** in the editor.

## 3. The flow helper (recommended first)

### 3.1 What the person sees

A "Build with an agent" panel in the flow editor (a shadcn Sheet or a docked
side card next to the inspector). The person types: *"After the build, run
the tests. If they fail, let the agent fix them, at most three times. Then ask
me before it opens a pull request."*

The agent reads the project (`package.json` scripts, CI config, the existing
flows, the project's skills) and answers with a short message and a
**proposal**. The canvas shows the proposal as a diff: new nodes and edges in
the accent colour, removed ones faded, changed nodes with a dot. The person
picks **Apply**, **Discard**, or keeps talking ("use the worker profile for
the fix step"). Apply changes the editor's draft only. The person saves as
today, and can undo.

A new, empty flow opens with the panel and three starting prompts drawn from
the project ("Run the tests and fix failures", "Turn an issue into a pull
request", "Review my open pull requests").

### 3.2 How it works

```
web panel ──assistant.send({projectId, flow, draft, message, thread})──▶ daemon
   ▲                                                                   │
   │ streamed events: text, tool calls, proposal                        ▼
   └──────────────────────────────── harness session (person's profile)
                                       cwd: the project's Clone
                                       tools over the bridge:
                                         get_draft       list_flows / get_flow
                                         list_profiles   list_skills
                                         list_tools      (CLI tools, connections)
                                         check_flow      propose_flow
```

- **One session per thread.** The first message starts a session, later ones
  resume it (`resumeSessionId`). The daemon keeps the thread (session id,
  messages, the last proposal) in memory first, in the database later.
- **The draft travels with each message.** The person's unsaved draft is the
  base, not the file on disk. `get_draft` returns it.
- **`propose_flow` takes the whole flow,** not a patch. Models write a whole
  JSON document more reliably than a patch, and the web diffs by node and edge
  id. The tool runs `flowSchema` and the validator and returns the issues. The
  agent must fix errors before the proposal reaches the person: the tool
  refuses a proposal with errors twice, then passes it on with its issues
  shown.
- **Read only.** The session reads the repo but must not change it. Plan mode
  on a by-mode harness drops the bridge tools (`adapter-session.ts`), so the
  helper runs in `default` mode and Night Shift's permission prompt on the
  bridge denies every edit, write and shell call that is not on a short
  read list. To check per harness before building (open question 1).
- **What the agent knows.** A system prompt from `@nightshift/flows`: the node
  types, the template syntax, outcomes and loop limits, with two example
  flows. Better as a **skill** shipped by Night Shift (`nightshift-flows`), so
  the same knowledge works in the terminal too (section 5).

### 3.3 Where the code goes

| Part | Package | Notes |
| --- | --- | --- |
| Tool definitions + the authoring prompt | `packages/agents/src/assistant/` | Takes an `AssistantPort` (read draft, flows, profiles, skills, tools). No daemon import. |
| The port's implementation, thread store | `packages/daemon` | Wires the port to the Space and the Device document. |
| `assistant.send` (streaming), `assistant.stop` | `packages/api/src/assistant/` | `ownerProcedure`: it runs on this computer's profile. |
| Chat state and diff of a proposal | `packages/client`, `packages/flows` (pure `diffFlows`) | `diffFlows` is pure flow logic, testable without a browser. |
| Panel and canvas diff | `apps/web/src/features/flows/assistant/` | Sheet, Item, Textarea, Button, Badge. The canvas nodes take a `proposed` state. |

### 3.4 Slices

1. **Ask about a flow.** Panel, threads, streamed answers, read tools only.
   "What does this flow do when the tests fail?" Proves the session, the
   stream and the read-only guard.
2. **Propose and apply.** `propose_flow`, `check_flow`, the canvas diff,
   Apply and Discard.
3. **Start from nothing.** The empty-flow panel and the starting prompts.
4. **Pick the agent.** Built as section 3.5.

### 3.5 Choosing the agent (built 2026-10-26)

Every suggest popover and the chat panel ("Ask an agent why" opens it)
show one compact picker: "Profile for help", a profile name, or
"Claude Code · haiku · low". It opens the fields of an Agent node:

- **Profile.** "Profile for help (<name>)" first: the setting, else the
  first profile that works. Then "None: choose the agent here", then the
  profiles of this computer.
- **Harness, Model, Effort.** With a profile, each field reads "From the
  profile (…)" until the person overrides it. A change on the profile for
  help pins that profile, with the change on top. Without a profile, the
  harness and model are required.

The browser keeps the choice (`localStorage`), and the helpers and the chat
share it. Each request sends `profile`, `harness`, `model` and `effort`
(`assistantAgentSchema` in `packages/flows`, the Agent node's own schemas).
No fields: the profile for help, as before. The daemon resolves them in
`pickAgent` (`packages/daemon/src/assistant`): a profile's harness, model and
effort with the overrides on top, or the request's own harness and model,
which must be added and installed here. The session stays read only
whatever the choice: a profile's permission mode, CLI tools and connections
never apply.

The chat needs a harness that takes Night Shift's tools
(`harnessTakesTools`, from `HARNESS_CATALOG`): pi and Grok Build cannot
chat. The chat picker disables them with "(cannot chat)", and the daemon
refuses them in plain words.

A chat keeps its thread when the agent changes. On the same agent, the
next message resumes the session. On another model or effort of a harness
that takes a model on resume (Claude Code, OpenCode, Codex), it resumes
too. On another harness, or another model of any other harness, a new
session starts with the chat so far (the last 20 messages and answers) in
its first prompt.

## 4. Other places where an agent helps

Ranked by value for the effort, after the flow helper.

### 4.1 "Fix this flow" from a failed run

On a failed or stopped run: **Ask an agent why**. The same helper gets one
more tool, `get_run` (the Run Log, step outcomes, the end reason, and the
transcript of the failing step). It explains what went wrong and proposes a
flow change: a missing retry edge, a loop limit, a command that uses the wrong
script, a prompt that lacks context. The proposal opens in the editor, as in
3.1. This closes the loop the product is about: the night fails, the morning
fixes the flow, not the code.

### 4.2 Field helpers in the inspector

Small, one-shot jobs next to one field, each a session with a step report and
an output schema (no chat):

- **Prompt:** "Write this prompt" from the node's name and its neighbours.
- **Output schema:** "Make a schema from this prompt", or from a sample of the
  data a later node reads.
- **Rule:** "Write the rule" for a Decision option from a sentence
  ("the tests passed and the check exited 0"). JSONata is the hardest field in
  the editor. Check the rule against the run's real values when a past run
  exists.
- **Command:** "Find the command" for "run the linter", from the project's
  scripts.

#### 4.2.1 Every helper, one look (built 2026-10-26)

Each helper is an outline "Suggest …" button with a sparkle, under its field
or beside the field's own action button. Each opens the same popover: title,
short description, three quick picks, an instruction box, then a preview with
Apply, Try again and Discard, and an Undo toast after Apply. The prompt keeps
Cmd/Ctrl+I and the rewrite of a selected part; the icon inside the field is
gone, "Suggest prompt" under the field replaces it.

Each kind has its own result shape in `suggestionSchema`, its own
`applySuggestion` branch (`packages/flows/src/assistant/apply.ts`, tests in
`apply-kinds.test.ts`), its own instruction and context in
`packages/agents/src/assistant/suggestion-prompt.ts`, its own checks in
`suggest.ts`, and its own preview in `apps/web/.../assistant/previews.tsx`.
The contract stays backward compatible: the three first kinds keep their
shapes, `nodeId` became optional (the flow's own fields take none), and
`toolSchema` is a new optional field.

| Field | Kind | Context the agent gets | Decision |
| --- | --- | --- | --- |
| Agent, Decision (model or person), Value (model): prompt | `prompt` | Template scope, outcomes, output schema, the selection | Kept, now a button |
| Agent, Value: output data | `output` | Who reads which data field | Kept |
| Any node: Set variables | `set` | The node's outcomes, the flow's variables | Kept |
| Agent: own outcomes | `outcomes` | The prompt, the edges that leave the node and where they go, the nodes that read `{{id.outcome}}` | Added. An outcome may name the one it replaces (`from`): its edges move along. The preview counts the edges that go. |
| Decision: options | `outcomes` | Same, plus who decides | Added. An option keeps the rule of the one it replaces. |
| Decision (rule): rules | `rules` | The options, the rule syntax, the template scope; the output schemas are in the flow | Added: JSONata is the hardest field. An unknown option or a rule that does not parse goes back to the agent. |
| Value (rule): expression | `expression` | The output schema, the rule syntax, the scope | Added |
| Command: command | `command` | The package manager (lock file), the `package.json` scripts, task files (`project-facts.ts`), the exits | Added |
| Wait (command): command | `command` | Same, and "exit 0 ends the wait" | Added |
| Subflow (each, from a command): source command | `command` | The item shape (`id`, `title`, `url`, `dependsOn`, `done`), the called flow's file to see which item fields it reads, the trackers to check (`gh`, `glab`, `acli`), two GitHub examples (a label, and the sub-issues of an issue from `githubSubIssuesCommand`) | Added 2026-10-26. It replaces the "Start from a recipe" menu: the recipes fit the first flows only, and the Jira one was never run. |
| Agent checker: What to check | `checker` | The outcomes, the prompt, the output schema | Added |
| Tool: arguments | `arguments` | The tool's input schema, which the editor sends (`toolSchema`) | Added. A required argument left out, or one the tool does not take, goes back to the agent. |
| Flow: description | `description` | The draft in short, each step in one line | Added |
| Flow: inputs | `inputs` | The current inputs and who reads each, the names templates read that the flow does not declare | Added |
| Decision (rule): note | — | Nothing reads it | Skipped |
| Flow: variables | — | The Set variables helper declares the ones a write needs | Skipped |
| Flow: outputs; Subflow: input bindings, list (JSON or files) | — | Short templates the variable list already offers | Later, if people ask |
| Agent: skill, profile, harness, model, tools, connections, MCP servers | — | Pickers over this computer's lists | Skipped: a choice, not writing |
| Command exits, secrets; Wait time, minutes, signal; timeouts, limits, device, run policy; edges (outcome, max) | — | Numbers, names and toggles | Skipped |

**Verified live** (2026-10-26) in a browser on a dev daemon and web app from
a worktree, Claude Code on Haiku at low effort, in a small project with a
`bun.lock` and three scripts: Suggest description and Suggest inputs
(applied; the flow's `{{pr}}` error went away), Suggest rules on a rule
Decision (applied, the rule error went away), Suggest command (proposed
`bun run test` from the lock file and the scripts; applied, then undone),
Suggest outcomes on an Agent (kept `pass` and its edge, added
`changes-requested`, removed `needs-input`; applied) and Suggest prompt
(the button). Not tried live: expression, checker, arguments, a Wait's
command and a Decision's options; their tests cover the prompt and the
checks.

### 4.3 Set up agents

On the Agents page:

- **Suggest profiles.** From the harnesses and models on this computer
  (doctor facts) and the project, propose two or three profiles (a worker, a
  reviewer, a cheap checker) with permission modes. The person accepts each.
  This also fills the gap that the rpgdotexe example had: profiles a flow names
  but the computer lacks. "This flow needs a profile named `validator`. Make
  one?"
- **Connect a service.** "Connect Linear": the agent finds the MCP server and
  the secret it needs and fills the Connection form. The person enters the
  secret.

The Decider could do the profile suggestion without a harness, but only with
OpenRouter or OpenAI (Jev is evaluate-only), so a harness session stays the
default.

### 4.4 A flow that builds flows

Once the authoring tools exist, they are also a **Connection** an Agent Node
can use. A flow "Improve my flows" runs every week: it reads the last runs,
finds the steps that fail most, and opens a pull request with a flow change.
The pull request is the Gate. This is Night Shift building Night Shift, one
of the VISION goals, without a model ever changing a graph at run time.

## 5. The same tools from the terminal

Status: built (2026-10-26).

`nightshift mcp` serves the authoring tools as an MCP server on stdio, with the
`nightshift-flows` skill. Claude Code (or any agent with MCP) in a terminal can
draw, check and save a flow and start a run, with the tools the chat in the
editor uses.

### Use Night Shift from your terminal

Night Shift must run on this computer (the desktop app, `nightshift serve` or
`bun run dev`). Add the server once:

```bash
claude mcp add nightshift -- nightshift mcp
# from source, with the dev daemon on port 3000 and the web UI on 3001:
claude mcp add nightshift -- bun /path/to/nightshift/apps/server/src/cli.ts mcp --ui http://localhost:3001
```

Start Claude Code in a project's folder and ask for a flow. The tools work in
the project whose Clone holds that folder. `--project <id, name or folder>`
picks another one, and each tool takes a `project` argument too
(`list_projects`). `--daemon <address>` (`NIGHTSHIFT_DAEMON_URL`) is where
Night Shift runs, default `http://localhost:$PORT`. `--ui <address>`
(`NIGHTSHIFT_UI_URL`) is where the links of runs and flows open, default the
daemon's address. Use `bun …/cli.ts mcp`, not `bun run --cwd apps/server`:
that changes the folder the server sees.

### How it works

- **Over the API, as this computer's owner.** The server is a client of the
  running daemon (`/rpc`, like `nightshift join`). A request from this
  computer gets the local session, so the terminal agent proves nothing
  else: it can do what the person at this computer can. It starts no daemon
  and opens no database. When no daemon answers, every tool says "Night Shift
  is not running on this computer. Start it, then try again."
- **One tool set.** `terminalTools` (`packages/agents/src/assistant/terminal.ts`)
  keeps the names of the editor's tools: `list_flows`, `get_flow`,
  `list_profiles`, `list_tools`, `list_skills`, `check_flow` and `get_run`
  (the same run report, read with the daemon's `chatRun`). A terminal has
  no draft and nobody who watches a proposal, so instead of `get_draft` and
  `propose_flow` it has `save_flow` (checks with `proposalIssues` and refuses
  on any error, then `flows.save`), `start_run` (`runs.start`, with the
  run's link), `list_runs` and `list_projects`. No new API procedure was
  needed.
- **The server** (`serveTools` in `packages/agents/src/assistant/mcp.ts`)
  lists any TanStack tool definitions over MCP and turns a thrown error into
  an error result. The subcommand is `apps/server/src/features/cli/mcp.ts`.

## 6. Order of work

1. Authoring tools + `nightshift-flows` skill, behind `nightshift mcp` (section 5).
2. Flow helper slices 1–2 (3.4).
3. "Fix this flow" from a failed run (4.1).
4. Flow helper slices 3–4, field helpers (4.2).
5. Profile suggestions and "make the missing profile" (4.3).
6. The flow that builds flows (4.4).

## 7. Open questions

1. Read-only per harness: does the permission prompt on the bridge see every
   write on Claude Code, Codex, OpenCode and pi? Else run the helper in its own
   throwaway copy of the project.
2. Threads: per flow, per project, or per person? Kept on this computer only,
   or synced to the Host so the phone can read them?
3. Can a Member of a shared Space use the helper on a Device they do not own,
   through an Offer? First version: owner only.
4. Cost: show the turn's tokens and cost in the panel, as a run step does?

### 7.1 Answer to question 1: read only, per harness (2026-10-26)

The assistant does not rely on a permission prompt. Night Shift's own
permission prompt on the bridge exists only for a Claude Code session with a
sandbox policy, and nothing answers it at design time. Plan mode is not the
answer either: Claude Code runs no MCP tool in plan mode, so the step report
and the assistant's own tools would be lost.

So the session runs in `default` mode with `readOnly: true` on
`AgentSessionInput` (`packages/agents/src/session/read-only.ts`). Each harness
makes that hold in its own way. Night Shift's bridged tools and the step
report work on every harness except where noted.

| Harness | How it stays read only | Strength |
| --- | --- | --- |
| Claude Code | `--permission-mode default`, `--disallowedTools Bash,Edit,MultiEdit,NotebookEdit,Write,Task,Agent` (a deny rule wins over the person's own allow rules in `~/.claude/settings.json`, which `default` alone would still apply), and `--strict-mcp-config` (no MCP server of the person's, only Night Shift's). Read, Glob and Grep need no permission. | Verified live with Haiku: asked to write a file and run `touch`, it found no tool for either, read the file and reported over the bridge. The folder had no new file afterwards. |
| Codex | `default` maps to Codex's `read-only` sandbox, `approval_policy = never`. MCP tools run without approval. | Strong: the OS sandbox refuses writes. Untested live (no `codex` here). The person's own MCP servers in `~/.codex/config.toml` still load. |
| OpenCode | `default` maps to permission rules that allow only `read`, `glob`, `grep`, `list`, `lsp`, the to-do list and skills, and deny everything else (`*` too, so the person's MCP tools are denied). `tanstack_*` stays allowed. | Strong, rule-based. |
| Grok Build | `default` maps to a sandbox policy with `fileWrite: deny`. Reports in text: no bridged tools. | Rule-based, untested live. |
| ACP agents (Copilot, Gemini, Cursor, custom) | `default` makes the adapter refuse every permission request. | As strong as the agent's own asking: an agent configured to run edits without asking can still write. Untested live. |
| pi | pi asks no permission at all, so refusing does nothing. A read-only session starts pi through a temp script that runs `pi --tools read,grep,find,ls` (pi's own read-only mode). pi-acp drops MCP: pi reports in text and cannot get the assistant's own tools. | Strong for pi's built-in tools. A chat on pi has no authoring tools. |

Night Shift itself still puts two short-lived files in the Clone during a
Claude Code session (the bridge's `.tanstack-mcp-bridge-*.json` and the
sandbox's `.tanstack-projected-*` marker) and removes them when the session
ends. Grok Build writes `.grok/` and removes it when the project had none.
