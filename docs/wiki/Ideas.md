# Ideas

The flows on this page do not exist yet. Each one is an idea. Anyone can build one and add it to the [community folder](https://github.com/xiduzo/nightshift/tree/main/community). [Community flows](Community-flows.md#share-your-flow) tells you how.

When you build an idea, remove it from this page in the same pull request.

Each idea climbs the ladder. A rule, or a check for what is new, comes first, so most runs end without a model. A decider makes the next choices, and an agent does the work. A Gate asks you only when the ladder runs out, or before an act that you cannot undo.

## Keep a market brief up to date

A schedule starts the flow each Monday. A Command reads the pages of the products and the companies that you follow. A rule keeps only the pages that changed since the last run. When nothing changed, the run ends. A decider sorts each change: it matters to you, or it does not. An agent adds what matters to a brief in the project's knowledge. The End node writes what changed as the run's report, so you read it on Home.

The run only writes files for you to read, so no Gate asks first.

It could use: a schedule, a Command with `curl`, a variable kept between runs, a Branch, a decider, the knowledge, an End node with a report.

## Follow new papers on a topic

A schedule starts the flow each morning. It reads the feed of a search for papers, and keeps only the papers that an earlier run did not see. A decider reads the abstract of each new paper, and picks: on your topic, or not. An agent writes a summary of each paper on your topic, in plain words, into the knowledge. The run's report lists the new papers with a link to each.

The run only writes files for you to read, so no Gate asks first.

It could use: a schedule, `kit:feeds/read`, a Subflow per paper, a decider, the knowledge, an End node with a report.

## Watch prices you care about

A schedule starts the flow each morning. A Command reads the prices with `curl` and `jq`. A rule keeps the prices that fell below your limit since the last run. When there are none, the run ends. A decider looks at each hit, and picks: a real offer, or noise, such as another size or a used item.

For each real offer, Night Shift sends you a message with the link, through the incoming webhook of your chat app. The message goes only to you, so no Gate asks first. No agent runs at all.

It could use: a schedule, a Command with `curl` and `jq`, a variable kept between runs, a decider, `kit:message/send` with a secret for the webhook address.

## Check your backups each morning

A schedule starts the flow each morning. A Command lists the newest backups, with their time and size. A rule passes when each backup is new, and about as large as the one before. Then the run ends with a short report of each backup, its time and its size. You read it on Home when you want to, and nobody gets a notification.

When the rule fails, a Command starts the backup again. When that fails too, an agent reads the logs and finds the cause. A Gate with the urgency Now then shows you the cause, and asks what to do. This Gate is the fallback: the ladder ran out.

It could use: a schedule, a Command, a Branch, an Agent, a Gate with the urgency Now, an End node with a report.

## Reorder supplies that run low

A schedule starts the flow each morning. A Command reads your stock with `curl`, from your shop or a spreadsheet. A rule keeps the items below their minimum. When no item is low, the run ends. A decider picks for each low item: order now, or wait for the next order from that supplier. An agent drafts one order per supplier, from the sales of the last weeks.

A Gate shows you each order before Night Shift sends it, because you cannot undo a sent order. A Command then sends it with `curl`.

It could use: a schedule, a Command with `curl` and `jq`, a Branch, a decider, an Agent, a Gate, a secret.

## Find and contact new leads

A schedule starts the flow each week. An agent searches the web for companies that fit the description that you give. A rule drops the companies that an earlier run found. A decider picks for each new company: a good fit, or not. An agent writes a short, personal first mail to each good fit.

A Gate shows you each mail before Night Shift sends it, because you cannot undo a sent mail. When you trust the drafts, give the Gate a cascade. A decider then approves the clear mails first, and you see only the rest.

It could use: a schedule, an Agent, a variable kept between runs, a decider, a Gate with a cascade, `kit:email/send` with its secrets.

## Draft the weekly newsletter

A schedule starts the flow each Friday. A Command reads the links that you saved this week in a notes file. A rule ends the run when there are fewer than three. An agent writes the draft in your voice, from your earlier issues in the knowledge. A decider checks the draft against your rules, and picks: ready, or one more try with a stronger agent.

A Gate shows you the draft before Night Shift publishes it, because every reader gets it at once. A Command then publishes it with `curl`.

It could use: a schedule, `kit:knowledge/folder`, a Branch, an Agent, a decider, a Gate, a Command with `curl`, a secret.

## Triage new issues each morning

A schedule starts the flow each morning. A Command lists the issues opened since the last run with `gh`. When there are none, the run ends. A rule labels each issue that uses one of your templates. A decider picks a label for each other issue. You can change a label later, so labels need no Gate.

An agent drafts a question for each issue that misses details. A Gate shows you each question before Night Shift posts it for the person who opened the issue.

It could use: a schedule, the CLI tool `gh`, a Branch, a decider, a Subflow per issue, an Agent, a Gate.
