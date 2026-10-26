# Agents inside Night Shift

**Status, 2026-10-26:** proposal. Nothing is built yet.

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
4. **Pick the profile.** A profile picker in the panel; default is the
   profile with the newest model on this computer.

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

Serve the authoring tools also as an MCP server, `nightshift mcp`, with the
`nightshift-flows` skill. Then Claude Code in a terminal can draw, check and
save a flow and start a run, and the in-app helper and the terminal share one
set of tools. It is the cheapest slice of all (no UI) and a good test of the
tools before the panel exists. It needs a decision on how a terminal agent
proves it may write this computer's flows (the Device's owner session, or a
token from Settings).

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
