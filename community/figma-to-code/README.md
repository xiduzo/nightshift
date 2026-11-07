# figma-to-code

An agent reads one frame from Figma and updates the matching components of your project. Your check proves the change. A Gate shows you what changed, and Night Shift commits it when you keep it.

The input `frame` takes a link to the frame, or its node id such as `12:34`. The input `check` takes the command that proves the change, for example `bun test`.

## Needs

<!-- generated:needs: bun run docs:reference writes this from flow.json. Do not edit it here. -->
- Agents: Claude Code · `sonnet`, Claude Code · `opus`
- Connections (MCP servers): `figma`
<!-- /generated:needs -->

The connection `figma` is the MCP server of the Figma desktop app. It needs a Dev or Full seat on a paid Figma plan. To add it:

1. On the computer that runs the flow, open the Figma desktop app.
2. Open the file of the frame.
3. With nothing selected, switch to Dev Mode (Shift+D).
4. In the right sidebar, choose **Enable desktop MCP server**.
5. In Night Shift, on the Agents page, add an MCP server with the name `figma` and the address `http://127.0.0.1:3845/mcp`.

Keep the Figma app open, with the file, while the flow runs. Night Shift cannot use the remote Figma server: that server needs a sign-in in a browser. See [the Figma MCP server](https://developers.figma.com/docs/figma-mcp-server/) for more.

## Import it

In a terminal, in the folder of your project:

```bash
curl -fsSL https://raw.githubusercontent.com/xiduzo/nightshift/main/community/figma-to-code/flow.json \
  | nightshift flows import - --name figma-to-code
```

Or save [flow.json](flow.json) as `figma-to-code.json`, and choose **Import flow** on the Flows page of your project. Night Shift names the flow after the file.
