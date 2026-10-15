# Night Shift Glossary

The ubiquitous language of Night Shift. Docs, the UI, and code use these terms. One name for one thing.

A Flow speaks only in Nodes, Edges, Steps, and Gates. A method's own language (for WTF: Epic, Feature, Trace) lives in the prompts and skills of a Flow, never in the engine.

## Actors

| Term | Meaning | Source |
|------|---------|--------|
| Developer | Owns a clone of the repo and the coding-agent CLIs. Draws Flows, starts Runs, and answers Gates. In local mode, the only user. | PLAN §1 |

## Objects

| Term | Meaning | Source |
|------|---------|--------|
| Project | A local clone that Runs can start in. | Slice 1 |
| Flow | A directed graph of Nodes and Edges, stored as `.nightshift/flows/<name>.json` in the Project's clone. | PLAN §2 |
| Node | One step of a Flow: Agent, Command, Decision, Gate, or For Each. Its id is also its name in templates. | PLAN §3 |
| Agent Node | A Node that runs one harness session with a prompt and/or a skill, a model, an effort, and a permission mode. | PLAN §3 |
| Command Node | A Node that runs one shell command in the Worktree. Exit 0 is `pass`. | PLAN §3 |
| Decision Node | A Node that reads earlier outputs and returns one of its declared labels. | PLAN §3 |
| Gate | A Node that waits for a person in the Needs-you inbox, with a question and its choices. | PLAN §3 |
| For Each Node | A Node that runs a sub-flow once per item of a list. | PLAN §3 |
| Start Node | The Node a Run begins at. | Slice 2 |
| Outcome | How a Step ended: `pass`, `fail`, `needs-input`, or a Decision label. | PLAN §3 |
| Edge | A link from a Node to the next Node, taken on one Outcome. | PLAN §2 |
| Max | How often a Run may take an Edge. Every loop needs an Edge with a Max. | Slice 2 |
| Retry Loop | An Edge back to an earlier Node, bounded by a Max. | PLAN §2 |
| Template Variable | A reference to an earlier output in a prompt or command, for example `{{check.log_tail}}` or `{{run.branch}}`. | PLAN §3 |
| Output | A named value a Step leaves for later Nodes, for example `summary` or `exit_code`. | Slice 2 |
| Issue | One problem the validator finds in a Flow. A Flow with an error cannot run. | Slice 2 |
| Run | One walk of a Flow in its own Worktree. It keeps a copy of the Flow from its start. | Slice 2 |
| Quick Run | A Run of a one-node Flow made from a prompt, without a Flow file. | Slice 2 |
| Step | One visit of one Node in a Run. | Slice 2 |
| Visit | The count of a Step among the Steps of the same Node: 1 for the first. | Slice 2 |
| Session | One harness session of an Agent Step. A resumed Step has more than one. | Slice 1 |
| Harness | A coding-agent CLI that runs Sessions: Claude Code, and later OpenCode and Codex. | PLAN §2 |
| Step Report | The Outcome and summary an agent reports at the end of its Session. | PLAN §3 |
| Transcript | The structured record of a Step: agent messages, tool calls, and command output, on disk. | Slice 1 |
| Worktree | A git worktree in a sibling directory of the clone, used by one Run. | Slice 1 |
| Event | One appended record of a fact that changed. | Slice 1 |
| Event Log | The append-only list of Events. Run status is derived from it. | Slice 1 |
| Run Policy | The rules for retries, rescue, blocked propagation, network grace, usage-limit waits, and the stop time. | PLAN §2 |
| Needs-you inbox | The list of open Gates. | PLAN §3 |
| Decider | The provider behind a Decision Node. The default is a small model with structured output. | PLAN §2 |
| GitHub Tools | The TanStack AI tools on top of `gh` that Agent and Decision Nodes can call. | PLAN §2 |

## Run status

| Term | Meaning |
|------|---------|
| running | A Step runs, or the Run is between Steps. |
| finished | The Run reached a `pass` with no Edge left to take. |
| stopped | A person stopped the Run. |
| failed | A Step errored, a `fail` or `needs-input` had no Edge, or a Retry Loop hit its Max. |
| interrupted | The daemon stopped while a Step ran. |

## Verbs

| Term | Meaning | Source |
|------|---------|--------|
| draw | Edit a Flow in the editor. | PLAN §1 |
| validate | Check a Flow and list its Issues. | Slice 2 |
| start | Begin a Run of a Flow. | Slice 1 |
| walk | Run the Steps of a Flow one after another, following Edges. | Slice 2 |
| report | End a Session with a Step Report. | Slice 2 |
| stop | Abort the running Step and end the Run as stopped. | Slice 1 |
| resume | Continue a stopped, failed, or interrupted Run at its last Node. | Slice 1 |
| take over | Hand a Session to a person with its resume command. | Slice 1 |
| retry | Take a Retry Loop back to an earlier Node. | Slice 2 |
| rescue | Retry a Node with a stronger model. | PLAN §2 |
| resolve | Answer a Gate with one of its choices. | PLAN §3 |

## Events

| Term | Meaning |
|------|---------|
| ProjectAdded | A clone became a Project. |
| ProjectRemoved | A person removed a Project. Its Runs and Events stay. |
| ProjectRestored | A removed Project's clone was added again. |
| RunStarted | A Run began, with its copy of the Flow. |
| WorktreeCreated | A Worktree was created for a Run. |
| RunResumed | A person resumed a Run. |
| StepStarted | A Step began a Visit of a Node. |
| StepReopened | A resume continued an Agent Step's Session in place. |
| StepEnded | A Step ended with an Outcome and its Outputs. |
| SessionStarted | A harness Session began for an Agent Step. |
| HarnessSessionAssigned | The Harness reported its own session id. |
| SessionEnded | A Session ended, with its cost. |
| EdgeTaken | The Run followed an Edge to the next Node. |
| StopRequested | A person asked to stop the Run. |
| RunEnded | The Run finished or failed, with the reason. |
