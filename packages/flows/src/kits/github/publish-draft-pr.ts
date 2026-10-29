import type { FlowInput } from "../../flow";
import { JSON_STRING_FUNCTION } from "../shell";

/**
 * `kit:github/publish-draft-pr`: pushes the current branch and opens a
 * draft pull request for it, or finds the one that is open. git and `gh`.
 */
export const publishDraftPrKit: FlowInput = {
	version: 7,
	description:
		"Pushes the current branch to GitHub and opens a draft pull request for it. A pull request that is open for the branch stays as it is. A branch without new commits ends with nothing to do.",
	inputs: [
		{
			name: "title",
			type: "text",
			description: "The title of the pull request.",
			required: true,
		},
		{
			name: "body",
			type: "text",
			description: "The description of the pull request, in Markdown.",
			default: "",
		},
		{
			name: "base",
			type: "text",
			description:
				"The branch to merge into, for example main. Empty, or a branch GitHub does not have: the default branch.",
			default: "",
		},
	],
	outputs: [
		{
			name: "number",
			value: "{{open.data.number}}",
			description: "The number of the pull request.",
		},
		{
			name: "url",
			value: "{{open.data.url}}",
			description: "The address of the pull request.",
		},
		{
			name: "created",
			value: "{{open.data.created}}",
			description: "true for a new pull request, false when one was open.",
		},
		{
			name: "branch",
			value: "{{push.data.branch}}",
			description: "The branch that was pushed.",
		},
		{
			name: "base",
			value: "{{push.data.base}}",
			description: "The branch the pull request merges into.",
		},
	],
	start: "push",
	nodes: [
		{
			id: "push",
			type: "command",
			label: "Push the branch",
			position: { x: 0, y: 0 },
			command: `# Pushes the current branch when it has commits that its base does not have.
set -e
${JSON_STRING_FUNCTION}
branch=$(git branch --show-current)
if [ -z "$branch" ]; then
	echo "The project is not on a branch. Switch to a branch first."
	exit 1
fi
base="{{base}}"
if [ -z "$base" ] || ! git ls-remote --exit-code --heads origin "$base" >/dev/null; then
	base=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
fi
git fetch origin "$base"
ahead=$(git rev-list --count FETCH_HEAD..HEAD)
if [ "$ahead" = 0 ]; then
	echo "$branch has no commits that $base does not have."
	printf '{"outcome": "no-commits", "branch": %s, "base": %s}\\n' "$(json "$branch")" "$(json "$base")" > "$NS_OUTPUT"
	exit 0
fi
git push --force-with-lease -u origin "$branch"
printf '{"branch": %s, "base": %s, "ahead": %s}\\n' "$(json "$branch")" "$(json "$base")" "$ahead" > "$NS_OUTPUT"`,
			exits: [
				{ name: "pushed", code: 0, color: "green" },
				{ name: "no-commits", code: "data", color: "gray" },
				{ name: "fail", color: "red" },
			],
		},
		{
			id: "open",
			type: "command",
			label: "Open the draft pull request",
			position: { x: 300, y: -120 },
			command: `# Finds the open pull request of the branch, else opens a draft one.
set -e
branch="{{push.data.branch}}"
open=$(gh pr list --head "$branch" --state open --json number,url --jq '.[0] // empty | {number, url, created: false}')
if [ -n "$open" ]; then
	echo "A pull request is open for $branch already."
	printf '%s\\n' "$open" > "$NS_OUTPUT"
	exit 0
fi
url=$(gh pr create --draft --head "$branch" --base "{{push.data.base}}" --title "{{title}}" --body "{{body}}")
echo "Opened $url"
gh pr view "$url" --json number,url --jq '{number, url, created: true}' > "$NS_OUTPUT"`,
			exits: [
				{ name: "open", code: 0, color: "green" },
				{ name: "fail", color: "red" },
			],
		},
		{
			id: "published",
			type: "end",
			position: { x: 600, y: -200 },
			status: "done",
			message: "Pull request #{{open.data.number}} is open: {{open.data.url}}",
		},
		{
			id: "not_opened",
			type: "end",
			position: { x: 600, y: -40 },
			status: "failed",
			message: "Could not open a pull request for {{push.data.branch}}",
		},
		{
			id: "no_commits",
			type: "end",
			position: { x: 300, y: 40 },
			status: "nothing-to-do",
			message: "No new commits on {{push.data.branch}} to publish",
		},
		{
			id: "not_pushed",
			type: "end",
			position: { x: 300, y: 160 },
			status: "failed",
			message: "Could not push the branch to GitHub",
		},
	],
	edges: [
		{ id: "push-pushed", from: "push", outcome: "pushed", to: "open" },
		{
			id: "push-no-commits",
			from: "push",
			outcome: "no-commits",
			to: "no_commits",
		},
		{ id: "push-fail", from: "push", outcome: "fail", to: "not_pushed" },
		{ id: "open-open", from: "open", outcome: "open", to: "published" },
		{ id: "open-fail", from: "open", outcome: "fail", to: "not_opened" },
	],
};
