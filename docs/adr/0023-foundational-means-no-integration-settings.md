# 23. Foundational means no integration settings

Status: accepted, 2026-11-11. Not built yet: wave 1, lane B builds typed outputs,
the three nodes and the kits. Wave 2, lane D builds the families in the editor
([the record](../research/any-domain-2026-11.md), Q6, Q14, Q35 to Q42). Replaces
the "not nodes" lists of two research records, named below.

## Context

Night Shift builds on fundamentals, not on other products. Two research records
drew the line:

- `docs/research/foundational-nodes.md` (2026-10-17), §4 "Not nodes": an HTTP
  request is "a Command (`curl`) or a Tool". Notify is "a Command (`gh pr
  comment`, `slack` CLI) or a Tool". Code is "a Command with a script, or a Value
  node by rule".
- `docs/research/node-review-2026-10.md` (2026-10-26), §5.6: "HTTP, Code, Filter,
  Sort, Remove Duplicates, Formatter and Notify are a Command or a Value by rule".
  Its §6 put the work with one product in kits on its CLI: GitHub and Jira kits,
  never a GitHub node.

That line served flows for code. Every kit today does GitHub or Jira work, or
fills the knowledge folder. Night Shift now serves any domain. A flow that reads a
feed, calls an API or sends a message pays for the old line:

- A secret in a request header goes through the shell into the arguments of
  `curl`.
- A Command's output is text, or JSON that a script writes. Nothing says its
  shape, so the next node guesses.
- A Command works in the run's copy of the project, so every call to an API needs a
  project and a shell.
- "Only what is new" needs memory per node. A flow builds it by hand.

The palette groups nodes by habit: do, decide, shape, wait, compose, end.
TouchDesigner groups its operators in families by data type, and its wires carry
that data. Night Shift's edges carry outcomes, and data travels by templates.

## Decision

1. **Foundational means no integration settings.** In the owner's words:
   "anything that does not need any explicit 'old school' integration settings. A
   CLI or MCP are also foundational, like bash or HTTP or webhooks." Files, git,
   cron, shell commands, CLIs, MCP servers that a person brings, HTTP and webhooks
   are foundational.
2. **Never a vendor node.** No Slack, GitHub or Telegram node. Work with one
   product is a kit, a flow that ships with Night Shift, on a CLI, HTTP or a
   webhook.
3. **A kit becomes a native node only on a named failure.** One of four:
   - It needs memory per caller.
   - It must run on a Host with no shell.
   - A secret would become shell text.
   - Its output must be typed.
4. **Nodes come in families by role.** A family says what a node does in the flow:

   | Family | Nodes |
   | --- | --- |
   | Do | Agent, Command, Tool, Web request |
   | Decide | Decision (as Gate and Branch) |
   | Shape | Value, Since last run, Convert |
   | Hold | Wait, Lease, Service |
   | Compose | Subflow, Join, End |

   Wait joins Hold, next to Lease and Service. Knowledge is a group of kits, not a
   family.
5. **An output field has a shape.** The data type is a second layer, on the
   output fields: text, number, yes/no, list, record or file.
6. **Three new native nodes.**
   - **Web request** (Do): its output is `{status, headers, body}`, typed. A secret
     header never becomes shell text. It tries again on a 429 or 5xx answer, and
     sleeps through the engine's wait. It needs no project folder.
   - **Since last run** (Shape): it ends on `new`, `changed` or `same`. It keeps
     its memory per node, in the Space. It also finds a change or a crossed
     threshold.
   - **Convert** (Shape): CSV, YAML, RSS and Atom XML, and Markdown tables to and
     from JSON, and HTML to text. It is pure: no files, no network.
7. **Kits and presets on top.**
   - **Send message:** a Web request to an incoming-webhook URL in a secret.
   - **Read a feed:** a Web request, then Convert, then Since last run.
   - **Send email.**
   - "Wait for a URL" is a new kind of Wait, not a kit.
   - Filter, Pick fields, Sort, Limit and Remove duplicates are one-click presets
     of a Value by rule, not nodes.
8. **No Notify node.** A Gate's urgency (now, today or later) decides whether it
   pushes ([ADR 21](0021-a-gate-has-a-brief-and-an-urgency.md)). The result of a
   run goes into its report (Q21), which is never pushed. A message to a chat is
   the Send message kit.
9. **Typed output is the default.**
   - Every new native node declares its output schema.
   - A Command gets an optional output schema. Flow outputs get types.
   - Without a schema, Night Shift infers one from the first real output or from a
     Suggest. A person can edit it, and the node keeps it.
   - A template path that the shape does not have is a warning in the editor.
   - A run fails on a mismatch only for a schema that a person wrote or confirmed.

## Alternatives

- **Keep the old line.** HTTP stays a `curl` Command and Notify stays a CLI, with
  no new code. But secrets stay in shell text, outputs stay untyped, and every call
  to an API needs a project and a shell.
- **Vendor nodes, as in n8n.** A node per app reaches many products fast. But each
  node keeps the API surface of another product and its own integration settings.
  CLIs, HTTP and the agents' own tools already reach those products.
  `node-review-2026-10.md` §6 refused a GitHub node for this reason.
- **Families by data type, as in TouchDesigner.** Its wires carry one type of
  data. Night Shift's edges carry outcomes, so a family by data type would not
  match a wire. The role is the family, and the data type is the shape of an output
  field.

## Consequences

- `docs/research/foundational-nodes.md` and `docs/research/node-review-2026-10.md`
  stay as written. This ADR replaces their "not nodes" lists:
  - An HTTP request is a node: Web request.
  - Notify stays out, because a Gate's urgency decides a push.
  - Filter, Sort and Remove duplicates are presets of a Value by rule. Formatter
    is Convert.
  - Code stays a Command with a script, or a Value by rule.
- The GitHub and Jira kits stay. They need a CLI and its login, no integration
  settings.
- The editor groups nodes by family, with a tint per family (Q39). The groups of
  today's dock (do, decide, shape, wait, compose, end) become the five families.
- Lane B decides the flow version. A new node type alone needs none: an older
  Night Shift refuses the unknown type, the safe side, as for Lease and Service.
- Flows of today keep running. Their nodes get inferred shapes, and a mismatch
  with an inferred shape is only a warning.
- Work with a product that has no kit goes through a CLI, HTTP, a webhook, an MCP
  server the person brings, or the agent's own tools.
