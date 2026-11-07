# Community flows

Community flows are flows that people share. Each one does one job, and you import it into a project. A starter flow needs one agent login and nothing else. A community flow can need more: a CLI tool, a secret, or an MCP server.

The flows are in the [community folder](https://github.com/xiduzo/nightshift/tree/main/community) of the repository. Each flow has a README that says what it needs and how to set it up.

<!-- generated:community: bun run docs:reference writes this table from the community folder. Do not edit it here. -->
| Flow | Does | Needs |
| --- | --- | --- |
| [`figma-to-code`](https://github.com/xiduzo/nightshift/tree/main/community/figma-to-code) | An agent updates the components of the project to match one Figma frame, and your check proves the change. You keep the change or drop it. | Agents: Claude Code · `sonnet`, Claude Code · `opus`. Connections (MCP servers): `figma`. |
| [`review-pr`](https://github.com/xiduzo/nightshift/tree/main/community/review-pr) | An agent reviews a pull request. You read the review, and Night Shift posts it on GitHub when you agree. | Agents: Claude Code · `sonnet`. CLI tools: `gh`. |
<!-- /generated:community -->

## Import a flow

1. Open the folder of the flow, and read its README.
2. Set up what the flow needs on the computer that runs it. See [CLI tools](Agents-and-profiles.md#cli-tools), [connections](Agents-and-profiles.md#connections), and [secrets](Computers-and-Hosts.md#secrets).
3. In a terminal, in the folder of your project, run this command. Put the name of the flow in place of `<name>`.

   ```bash
   curl -fsSL https://raw.githubusercontent.com/xiduzo/nightshift/main/community/<name>/flow.json \
     | nightshift flows import - --name <name>
   ```

   Or save the `flow.json` of the flow as `<name>.json`, and choose **Import flow** on the Flows page. Night Shift names the flow after the file.
4. Open the flow. Change its prompts, models, and inputs to fit your project.

## Share your flow

When a flow does its work for you, share it. Add it to the community folder in a pull request. [Contributing](https://github.com/xiduzo/nightshift/blob/main/CONTRIBUTING.md#share-a-flow) gives the steps and the rules.

A shared flow runs on each computer that has what it needs. It holds no paths of your own, no Keychain, and no content of a client. It names a secret only as `${NAME}`.

To find a flow that nobody has built yet, see [Ideas](Ideas.md).
