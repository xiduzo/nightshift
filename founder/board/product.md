# Product lens
Score: 5/10 | Vote: FUND IF

## What is strong
- **The one-sentence promise exists, and it is good.** "Draw your agent pipeline as a flow. Night Shift runs it on your machine while you sleep. You wake up to a stack of pull requests and a short list of decisions that need you." It describes a moment the customer can picture: the morning, coffee, a short inbox. That is the right place to start.
- **The core loop is real and in daily use.** The author has run a real project every night for about two weeks and says it earns its keep. The product works for its first user, which is rarer than it sounds.
- **The engine owns the hard parts.** Order, retries, loop limits, stop time and usage-limit waits are what a script does badly. Moving them out of a hidden script is a real improvement in experience.
- **Craft is visible.** Copy rules, a component system and a "hide the internals" voice show care for details that most pre-alpha tools skip.

## What would kill it (the top 3, most dangerous first)
1. **No focus. It does ten things for one user.** Flow editor, nine node types, six agent families, multi-computer pairing, Spaces with roles, Offers, a phone app with push, a knowledge base with semantic search, an AI assistant, a CLI and an MCP server. All of this exists before a second user. The Product lens asks what to cut until one thing is brilliant. Right now nobody, including the founder, has had to choose. Each extra surface is a seam that a builder with a day job must keep working.
2. **The first five minutes are probably hard.** Before the morning moment, a new team must install a desktop app, install and log in to agent CLIs, connect a git repo, maybe run a Host on a server, pair computers, and draw a flow on a canvas. The brief does not describe this path or measure it. If the first night does not produce one useful pull request, the promise never arrives.
3. **The experience depends on seams the product does not own.** Agent CLIs, their logins and their usage limits belong to other vendors and change often. Git hosting, CI and the team's own repo are also outside. "Own the whole experience" is hard when every night's result goes through other people's tools. When a run fails at 3 a.m. because a CLI changed, the customer blames Night Shift.

## The questions I would ask the founder
- If you could keep only one screen, which one? The canvas, the morning inbox, or the run view?
- What does a stranger's first night look like, step by step? How long from download to the first pull request they keep?
- What would you remove today if a second user started next week?
- Is the customer the person who draws the flow, or the person who answers the gates in the morning? The design changes with the answer.
- Do teams of 2–15 want to draw pipelines, or do they want the morning result with a ready-made flow? (Open: needs user interviews, see /founder-consumer.)
- Who else already sells overnight agent pipelines to this buyer, and what does their first five minutes look like? (Open: /founder-competitors.)
- Would a team pay for this, and for which part? (Open: /founder-cfo and /founder-consumer.)

## If FUND IF: the conditions
1. **Name the one thing in writing**: the morning inbox of pull requests and gates. Freeze or hide every surface that does not serve it (Offers, knowledge, extra agent families) until three outside teams use it.
2. **Ship one starter flow that works on the first night** for a common case (for example: issue to draft pull request, tests run, one gate), with Claude Code only.
3. **Measure the first five minutes**: put three developers who are not the founder through install to first kept pull request. Record time and every place they stop. Fix those places before any new feature.
4. **Get three outside teams to run it nightly for two weeks**, and report how many pull requests they merged and how many gates they answered.
