# 35. Night Shift has six agents of its own

Status: accepted, 2026-11-13. Built, 2026-11-13 (98679c2b and the commits after it).
The note "Agent positioning and access" (13 November 2026) holds the research and the
sketches.

## Context

One helper appeared under seven labels: "Ask an agent", "Ask why", "Improve the flow",
"Improve with an agent", "Build with an agent" and "Suggest …". Each button was made by
hand. The first message of a chat was a string in the web app or in the client package.

The model behind a button was chosen in five places by five rules:

- A picker under each prompt box, kept in the browser. Then the setting "Profile for
  help". Then the first profile that worked.
- "Ask why" ignored the picker.
- A Decision by a model read a setting, a Model Profile, or the node.
- The brief of a Gate ran on one provider, fixed in code. A person without that key got
  no brief and could not change it.
- Meaning search had its own setting.

The prompt and the tools of each helper sat in three code paths. No list said which
button starts which agent with which tools. A helper session had no turn limit and no
budget, and its cost was shown once and then gone.

Two different things can answer, and the product blurred them. An agent is a program
that works in turns and can take tools (a Harness). A model gives one answer to one call
(a Decider).

## Decision

1. **Six built-in agents, in one list.** `BUILTIN_AGENTS` in `packages/flows` names them:
   Builder, Improver, Explainer, Field writer, Decider, Brief writer. Each has a fixed
   job. The product owns its prompt and its tools. No API route returns a prompt.
2. **Each agent says what can answer for it.** The Builder and the Improver need an
   agent that takes Night Shift's tools. The Explainer and the Field writer take an
   agent or a model. The Decider and the Brief writer take a model.
3. **The person chooses who answers, per agent.** The setting `builtinAgents` of a
   computer keeps one answer for each agent: an agent (a profile, or a Harness and a
   model) or a model (a Model Profile, or a Decider and its model). The save refuses a
   kind that the agent does not take. An agent without a choice follows its computer:
   the old "Profile for help", then the first profile that works. The Decider and the
   Brief writer without a choice run on TypeSafe, as before.
4. **The choice is per computer.** A Host has its own. "Ask why" from a phone uses the
   Host's Explainer.
5. **One job runs two ways.** The Explainer and the Field writer send the same prompt
   and the same answer shape to an agent session or to one model call
   (`runReportSession`). A model reads no files.
6. **The chat is the Builder or the Improver.** The entry decides. A chat about a run,
   or one that an improve button starts, is the Improver's, and it stays so. The
   Builder reads no run.
7. **Every tool has a tier, and every agent a tool list.** `read`, `propose` or `act`
   (`packages/agents/src/assistant/builtin-tools.ts`). A session gets exactly the tools
   that its agent lists. No built-in agent holds a tool of the `act` tier. A table test
   holds this. The terminal server publishes the tier as MCP annotations.
8. **An answer has limits.** Each agent names the most turns and the most money of one
   answer. The session stops there, and the person can ask again.
9. **A read-only session cannot reach the web.** The deny list of Claude Code names
   WebFetch and WebSearch. What such a session reads is private.
10. **A button names an entry, not a prompt.** `AGENT_ENTRIES` maps each place in the
    product to its agent and its label. A chat request carries the entry. The first
    message comes from `entryOpening`, which the page and the agent both read.
11. **A node that names no decider follows the Decider of its computer**, when the
    person chose one. So does a Gate's brief with the Brief writer. A node that names a
    decider or a profile keeps it.
12. **The cost of help is kept.** Each answer of the Builder, the Improver, the
    Explainer and the Field writer writes one record. Spend shows it as "Help".

## Consequences

- The picker under the prompt box is gone from the chat, from Suggest and from "Ask
  why". Settings is the one place that decides. A quick run keeps its picker: it is a
  real run.
- The setting `assistantProfile` has no field any more. It stays as a fallback, so an
  old choice keeps working.
- A person with only a local model and no agent gets "Ask why", "Suggest", Decisions and
  Gate briefs. "Build" and "Improve" wait for an agent.
- A flow file does not change. The flow format stays the same.
- `nightshift mcp` is not a built-in agent. It still holds the `act` tools, with the
  person's rights. Access levels for it are a later decision.

## Not decided here

- Limits per Space and per project, and the helper on a Host by role.
- An action that a built-in agent starts after the person confirms it.
- Whether a small local model writes a good answer for the Explainer. This needs a trial
  on real runs.
