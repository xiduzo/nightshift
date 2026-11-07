# Ideas

The flows on this page do not exist yet. Each one is an idea. Anyone can build one and add it to the [community folder](https://github.com/xiduzo/nightshift/tree/main/community). [Community flows](Community-flows.md#share-your-flow) tells you how.

When you build an idea, remove it from this page in the same pull request.

## Triage new issues each morning

A schedule starts the flow each morning. An agent reads the issues opened since the day before. It proposes labels, finds duplicates, and drafts a question where details are missing. A Gate shows you the proposal before anything changes on GitHub.

It could use: a schedule, the CLI tool `gh`.

## Write release notes from merged pull requests

An agent reads the pull requests merged since the last release. It writes release notes for the people who use the product, not for the people who build it. A Gate shows you the draft. When you keep it, Night Shift saves a draft release on GitHub.

It could use: the CLI tool `gh`.

## Keep translated docs up to date

When a doc in the source language changes, an agent updates the same doc in each other language. It changes only the parts that changed in the source. A Gate shows you the changes, so a person who reads the language can check them.

It could use: a webhook schedule on each push, `git`.

## Turn meeting notes into tasks

You give the notes of a meeting. An agent finds the decisions and the tasks, each with an owner and a date. An Ask lets you choose the tasks to keep. Night Shift then files each task in your tracker.

It could use: an Ask, the CLI tool of your tracker.

## Watch a changelog you depend on

Each week, Night Shift reads the changelog of a tool or a service that your project uses. An agent tells you which changes touch your project, and why. When a change needs work, it opens an issue.

It could use: a schedule, `curl`, the CLI tool `gh`.

## Summarize the week for your team

Each Friday, an agent reads the work merged this week, the open issues, and the runs that failed. It writes a short summary in plain words for people who do not read code. A Gate shows you the summary before Night Shift posts it.

It could use: a schedule, the CLI tool `gh`.

## Draft answers to new questions from your docs

When a person asks a question in GitHub Discussions, an agent looks for the answer in your docs. It drafts a reply with links to the pages it used. A Gate shows you the draft, and you choose to post it or not.

It could use: a webhook schedule, the CLI tool `gh`.

## Find broken links in your docs

Each week, a command checks every link in your docs. An agent fixes the links that moved, and lists the links it cannot fix. A Gate shows you the changes before Night Shift commits them.

It could use: a schedule, `curl`.
