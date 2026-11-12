# 34. A node type has one definition

Status: accepted, 2026-11-12. Built, 2026-11-12, in architecture series 3, lanes L1
(57198262, ae6378a3) and L2 (a9be23bb to 7d8bd9a6).
[ADR 22](0022-a-project-folder-is-optional.md) stays as written. Decision 5 adds one
fact of the node type beside its `works()`.

## Context

A fact of a node type had many homes. `packages/flows` held 27 tables per node type:
switches, records and sets on `node.type`, outside the node's own file. Twelve of them
let a new node type pass in silence, through a `Set`, a `Partial`, a `default` branch or
a switch that returns nothing. The engine kept copies of two of them (`isChosenEnd`,
`endedLabel`), with a comment that asked to change both together.

"Touches a computer" had three copies, which answer three questions:

- The Offer check of `devices`: does the step run a process, a session, a tool, a web
  request or a model on the Device? A Call runs nothing there itself.
- The Service placement of `flows`: where does the work of the node land? A Call's flow
  runs where the Call runs, so a Call counts.
- `works()` of the engine (ADR 22): what does the step need at run time, the run's copy
  or only the Device?

`offers.ts` called its switch "the Offer's rule, not a fact of each kind" (60f36000). At
that time, the only home for a fact of each kind was the engine's `NodeKind`.

The texts a node holds (templates, shell commands, rules) had four lists that people kept
by hand. They were the rename walk (340 lines), the check's walk, `commandOf`, and a test
of 605 lines that held the others equal. `commandOf` saw 3 of the 7 command fields. So
the login check and the folder check did not see an Agent's check command or a Service's
start, ready and stop commands. On 12 November, 8 fix commits touched reads and renames.

## Decision

1. **Each node type has one definition.** `nodes/<type>.ts` exports a `NodeDefinition`.
   `NODE_DEFINITIONS` in `flow/node.ts` lists them, typed against the flow schema. A type
   without a definition, or a definition of no type, does not compile. A table test
   checks the list against the schema in both directions.
2. **The definition holds every fact of the type that holds without a run:**
   - its label and family, and whether it stands in for a test run,
   - its outcomes and their colours,
   - its output fields, the typed one and the main one,
   - its check, its secrets and its texts,
   - which outcomes end the flow, and the label a Subflow reports then,
   - whether it touches its computer,
   - its new nodes and what a new node takes,
   - a sample node.

   The type's file writes every fact. A shared value is a named helper, not a default.
3. **The old tables read the definition.** `NODE_TYPE_LABEL`, `NODE_FAMILY`,
   `nodeOutcomes`, `endsFlow` and the rest keep their names. The engine's `NodeKind` lost
   `isChosenEnd` and `endedLabel`. `route()`, the kept shapes and the Call node read the
   functions of `flows`.
4. **A fact in the words of a higher vertical stays there.** It is a table keyed by the
   node type, so a missing type still does not compile. Two such tables are the JSON
   Schema of each output field (`shapes/`) and the guide's text for a model
   (`assistant/guide.ts`).
5. **"Touches a computer" is a fact of the node type.** `touchesDevice` says whether a
   step runs a process, a session, a tool, a web request or a model on its computer,
   beyond the run's folder.
   - The Offer check of `devices` reads it. The policy, what an Offer allows, stays in
     `devices`.
   - Service placement reads it, and counts a Call too.
   - `works()` stays the engine's, as ADR 22 says. An engine test holds the two together:
     a step that touches its computer needs one at run time.
   - An End that reads a report file, and a Call that gives each item a branch, need only
     the run's folder. They do not touch their computer.
6. **A node type declares the texts it holds.** `texts` lists, as data, the positions
   where the node holds a template, a shell command or a rule. `plain` lists its other
   string fields. One walk (`nodes/texts.ts`) reads them for a rename, the reads, Make
   subflow, a paste and the command checks.
7. **Tests hold the declaration.** For each type, the declared texts and plain fields are
   the fields of the schema that can hold a template. Every text that the check reads is a
   declared text of the same kind, with the same own names.
8. **The check keeps its own walk of the texts in use.** Its guards are rules of the
   structure: a Value by a model reads no field of an Ask, for example. About 180
   assertions of the validate suite depend on the order of the issues. The test of
   decision 7 keeps that walk inside the declaration.
9. **Every command field counts.** The login check and the folder check read every
   declared command (`commandsOf`), an Agent's check and a Service's start, ready and stop
   commands too. Suggest fills only the command of a Command, a Wait or a Call
   (`suggestedCommandOf`).

## Alternatives

- **One file for every per-type piece**, the text for a model and the JSON Schema of
  each field too. `nodes/` would need the kit layout and the words of `shapes/`. That is
  a cycle, or constants moved to a lower vertical for one caller each.
- **A lookup at each call site** (`definitionOf(node).outcomes(node)`). The root would
  name fewer functions, but every caller writes the lookup again.
- **One walk function per node type for its texts.** That is the 340-line switch in 14
  files. It is typed, but a complete walk still needs fixtures, and plain fields stay
  outside it.
- **The check reads the declaration too.** One walk for all. But the check would need a
  rule of what is in use and a place for each text. That is a second copy of its guards,
  and a new order of the issues.
- **The Offer keeps its own switch**, because it is the Offer's policy. But the fact it
  reads is the same for Service placement, and two copies can drift.

## Consequences

- A new node type is one file and one line in the list. The compiler and the table test
  name each fact that it still needs.
- The root of `flows` did not get smaller (517 to 519 names). It gained the three
  functions that the engine and `devices` read instead of their copies.
- The login and folder warnings show for an Agent's check and a Service's commands, also
  on existing flows (ebfc09f9).
- Make subflow reads rules with the rule parser. `$$.run.<field>` now blocks a Subflow,
  and the text "run.flow" inside a string does not.
- The assistant's prompts read the texts in use, as the canvas draws them. Labels,
  descriptions and fields that a node does not use are no longer reads.
- Two facts are not in the definition yet: the connections a node names, and the node's
  own options. The three copies of the connections disagree on a Tool with an empty
  connection, so each needs a decision first.
- `definitionOf` erases the type of each node with a cast, as the engine's `kindOf` does.
  A caller must pass the same node that it asked about.
