# 37. Night Shift learns from runs that ended

Status: accepted, 2026-11-13. Built, 2026-11-13.

## Context

Every agent step of a run gets one instruction: "If you learned something about this
project that would help the next agent, add it to `learnings`". In practice this almost
never fires. One real project had 0 proposed learnings in about 680 agent steps. The
whole computer had 1 step that ever proposed one. An agent that is busy with its task
does not reflect.

The facts that teach something are in the run when it ends: a step that failed and a
later try that worked, a person who answered a Gate and wrote why, an agent that could
not go on without a person, a failure that the run before had too. Another agent can
read them after the run, with nothing else to do.

## Decision

1. **A seventh built-in agent, the Learner.** It is not a job of the Improver. The
   Improver takes only an agent with Night Shift's tools (ADR 35), and its limits fit a
   chat (40 turns, 2 USD). A look back needs one answer, and it should run cheaply on a
   model. So the Learner takes an agent or a model, as the Explainer does. Its limits
   are 10 turns and 0.25 USD. It has no tools and reads no files: the evidence is in its
   prompt (`learnFromRun`). Settings lists it, and Spend shows its cost apart.
2. **Only a run with a signal.** A pure check (`learningSignals`) reads the run and the
   run of the same flow that ended before it. The signals are: a fix after a failed try,
   a fix since the run before, the same failure as the run before, a step that needed a
   person, and a Gate that a person answered with a reason. A run without a signal costs
   nothing: no evidence is built, and no model is asked. A test run has no signal.
3. **The Walker looks back.** The computer that walks the run does it when the run
   ends: a Host for its own runs, a Device for the runs it walks. The transcripts are
   there. It uses that computer's choice for the Learner. The cost goes to the run's
   Space, in the name of that computer's owner (ADR 36). One look at a time.
4. **Bounded evidence.** The run's facts and steps, the answers with their reasons, the
   steps that went wrong with the last 60 lines of their transcripts, what worked, and
   the notes the project has (waiting and kept), so the Learner does not repeat them.
   24 000 characters at most (`learningEvidence`).
5. **At most five notes, in the run's own file.** `learnings/proposed/<run id>.md`. The
   name cannot clash with a step's `<run id>.<step id>.md`. The Review page, the Gate of
   `kit:knowledge/review-learnings`, Keep and Delete already take it: it was the name
   before steps had files of their own. Its header says "What Night Shift learned from
   run <id>." An answer with no note writes nothing.
6. **Never kept by itself.** The notes wait for Keep or Delete, as a step's do. Close
   notes compare them too.
7. **On by default, off per project.** The switch "Learn from runs" is on the Review
   page. It is a setting of the project's knowledge document, so it holds for every
   computer of the Space. The learnings belong to the project's knowledge, and the
   person who reviews them decides whether they want more. A switch per computer would
   leave a Host's runs to a setting that the Members of the Space cannot see.
8. **The step's own instruction stays.** An agent may still add `learnings` to its
   report.

## Consequences

- A run that needed a fix or a person can add up to five notes to the Review page.
- A look back costs one answer of the Learner. On an agent with no choice in Settings,
  that is a short session on the first agent that works. A model costs less.
- A run that ends again after a resume is looked at again. Its notes go to the same
  file, and the Learner reads the notes that wait, so it does not repeat them.
- An older Host does not know `learner` rows of `answer_cost`. It ignores them, as
  ADR 36 says for any agent it does not know.
- A legacy `<run id>.md` file from an agent shows on the Review page as learned from a
  run.

## Not decided here

- Whether to keep a note when the Learner proposes it again and again.
- A look back at the runs that ended before this change.
- A signal for a run that a person stopped, or a Decision by a model that was unsure.
