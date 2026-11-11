# Community flows

Flows that people share. Each folder holds one flow that you import into a project.

A starter flow of Night Shift needs one agent login and nothing else. A community flow can need more: a CLI tool, a secret, or an MCP server. Its README lists what it needs.

This folder is a first step to a flow library that the community runs. Its shape can change.

To share a flow with one person, you need no pull request. Export it in the flow editor with **Export as file**, and send the file. The other person chooses **Import flow** on the Flows page of their project.

<!-- checked:community: every folder with a flow.json has one row. bun run docs:reference checks it. -->
| Flow | Does |
| --- | --- |
| [`figma-to-code`](figma-to-code/) | An agent updates the components of your project to match one Figma frame. You keep the change or drop it. |
| [`review-pr`](review-pr/) | An agent reviews a pull request. Night Shift posts the review on GitHub when you agree. |
<!-- /checked:community -->

## What a folder holds

- `flow.json`: the flow, as `nightshift flows export` writes it.
- `README.md`: what the flow does in 2 or 3 sentences, its Needs block, and how to import it.

## Import a flow

In a clone of this repository, run:

```bash
nightshift flows import community/<name>/flow.json --name <name> --project <your project>
```

Without `--name`, the flow gets the name `flow`. You can also save `flow.json` as `<name>.json` and choose **Import flow** on the Flows page of your project.

## Add a flow

1. Build the flow in Night Shift.
2. Run it on a real project until it does its work.
3. Make the folder `community/<name>/`. Use the name of the flow.
4. Export the flow into it: `nightshift flows export <name> --out community/<name>/flow.json --project <your project>`.
5. Copy the `README.md` of another flow into the folder.
6. Change the copy: what your flow does, and how to import it. Leave the Needs block as it is.
7. Add a row for your flow to the table above.
8. Run `bun run docs:reference`. It fills the Needs block and the table of the wiki, and it checks the flow.
9. Open a pull request.

## The rules

- **Self-contained.** The flow runs on each computer that has what its Needs block lists. It uses no local scripts, no paths of your own (`/Users/`, `~/`), no Keychain, and no skills of your own.
- **No client or private content.** The flow and its README hold no names, prompts, code, or data of a client or an employer.
- **Secrets by name only.** A flow reads a secret as `${NAME}`. A Command node lists the names in its secrets. Never put the value of a secret in the flow.
- **A Needs block.** The README has a `<!-- generated:needs -->` block. `bun run docs:reference` fills it from `flow.json`.
- **The check passes.** `bun run docs:reference --check` passes. It fails when the flow does not load, has an error, names a folder of one user, or reads the Keychain.
