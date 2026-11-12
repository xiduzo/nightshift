# 33. One place a flow is checked in

Status: accepted, 2026-11-12. Built, 2026-11-12, in architecture series 3, lane L7
(ad5d5364, d3ebca6d).

## Context

Five doors check a flow: the editor, the chat in the editor, `nightshift mcp`, Suggest
and the docs script. All five call the same checks. Commit ca4a6c9e says why: "the
backend's propose_flow and the web ask this one function, so both agree on what valid
means". But each door gave the checks its own facts of the project:

| Fact | Editor | Chat | `nightshift mcp` | Suggest | Docs script |
| --- | --- | --- | --- | --- | --- |
| The flows, the name | yes | yes | yes | the name only | yes |
| Connections, CLI tools, folder | yes | yes | yes | no | no |
| Profiles | with their modes | names only | names only | no | no |
| Devices | yes | no | no | no | no |

Each fact came later than the check, and it reached the web first. So one flow got other
issues at each door:

- The chat and `nightshift mcp` accepted a Device id that the editor refused. Their words
  for an unknown Device (b2862645) never got the list of Devices.
- They reported "There is no profile" for a profile on a Device whose profiles this
  computer cannot know. The editor did not.
- Only the editor warned about a profile whose permission mode refuses commands. Commit
  a73c4584 said that the assistant's proposals warn too.
- Suggest checked its answer with no facts at all.

## Decision

1. **One value holds the place.** `FlowPlace` in `@nightshift/flows` (`draft/check.ts`)
   holds six raw facts. They are the project's flows, the flow's name, the Devices with
   their profiles, the connections, the CLI tools and whether the project has a folder. A
   fact that still loads is not in it yet, and the checks that need that fact wait.
2. **The check derives the rest.** `checkDraft(flow, words, place)` and
   `proposalIssues(base, proposal, place)` take the place whole. They work out the
   profiles, their permission modes, the Devices whose profiles are not known here, and
   the Device ids. No door picks a derived fact.
3. **One adapter per runtime fills the place**, from the sources the editor reads: the web
   editor (`useEditorData`), the daemon for the chat and Suggest (`assistant/place.ts`),
   and the server for `nightshift mcp`. The docs script gives the flows and the name,
   because a community flow has no project.
4. **An agent's check keeps two filters, each with its own reason.**
   - A name that the draft already uses is no error for an agent (ca4a6c9e). The person
     put it there, and the editor shows it. The filter now covers the Device ids of the
     draft too.
   - Suggest sends back only the errors that its answer adds (b2916175). A flow that has
     errors already does not block a suggestion for one field.
5. **Suggest checks in the Space, as the chat does.** The API gives the Space and the
   Person to `AssistantService.suggest`. No route changed.
6. **The chat skips a fact that fails to load**, as the editor does. `nightshift mcp`
   stays strict, so "Night Shift is not running" still shows.

## Alternatives

- **A place port** (`checkFlowAt(port, flow)`), from which the check reads its facts.
  But `flows` has no I/O (STRUCTURE §2). The web also computes the check from cached
  queries, one fact at a time.
- **Derived facts and a helper** (`checkDraft(flow, words, placeFacts(devices))`). Each
  caller still picks which derived fact to give. That is how the doors drifted.

## Consequences

- One test pins the decision. With one place, the editor's `checkFlow` and the agent's
  `proposalIssues` give the same issues on 10 rows (`apps/web`, `flow-draft.test.ts`).
- A proposal that fails the schema gets only the schema issues, so the agent fixes the
  shape first. The editor shows the schema issues and the rest. This difference is on
  purpose.
- An agent that guesses a Device id now gets its proposal refused.
- Suggest reads the Devices and the flows before its session. In a hosted Space, that is
  one more call to the Host.
- A new fact of the place goes in `FlowPlace` and in each adapter. The checks read it
  from there.
