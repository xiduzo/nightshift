# review-pr

An agent reviews a pull request: it approves it or requests changes, with a summary and comments on lines. A Gate shows you the review. When you agree, Night Shift posts it on GitHub.

The input `pr` takes the number or the link of the pull request.

## Needs

<!-- generated:needs: bun run docs:reference writes this from flow.json. Do not edit it here. -->
- Agents: Claude Code · `sonnet`
- CLI tools: `gh`
<!-- /generated:needs -->

Sign in to `gh` on the computer that runs the flow: `gh auth login`.

## Import it

In a terminal, in the folder of your project:

```bash
curl -fsSL https://raw.githubusercontent.com/xiduzo/nightshift/main/community/review-pr/flow.json \
  | nightshift flows import - --name review-pr
```

Or save [flow.json](flow.json) as `review-pr.json`, and choose **Import flow** on the Flows page of your project. Night Shift names the flow after the file.
