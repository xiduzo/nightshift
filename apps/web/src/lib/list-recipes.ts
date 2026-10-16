import { githubSubIssuesCommand } from "@nightshift/flows";

/**
 * A recipe fills the source command of a For Each node: a command on a
 * tracker's CLI, or on a file, that prints the list as JSON. The person
 * edits it from there. Each item carries `id`, `title`, and when the
 * source knows them, `url`, `dependsOn` and `done`.
 */
export type ListRecipe = {
	name: string;
	/** What the list holds, and what to change. */
	description: string;
	command: string;
};

export const LIST_RECIPES: readonly ListRecipe[] = [
	{
		name: "GitHub sub-issues of an issue",
		description:
			"The sub-issues of issue {{epic}}, with their blocked-by links. Closed ones count as done. The first jq line holds the label filters.",
		command: githubSubIssuesCommand({ parent: "{{epic}}" }),
	},
	{
		name: "GitHub issues with a label",
		description:
			"The open issues with the label ready, newest first. Change the label and the limit.",
		command: `gh issue list --label ready --state open --limit 200 --json number,title,body,url,state --jq '[ .[] | { id: (.number | tostring), number, title, body, url, state } ]'`,
	},
	{
		name: "GitLab issues",
		description:
			"The open issues with the label ready in the project of this repository. Needs jq on this computer.",
		command: `glab issue list --label ready --output json | jq '[ .[] | { id: (.iid | tostring), number: .iid, title, body: .description, url: .web_url, state } ]'`,
	},
	{
		name: "Jira issues (acli)",
		description:
			"The work items a JQL query finds. Check the field names against what acli prints. Needs jq on this computer.",
		command: `acli jira workitem search --jql "project = ABC AND statusCategory != Done ORDER BY rank" --json | jq '[ .[] | { id: .key, title: .fields.summary, body: .fields.description, url: .self } ]'`,
	},
	{
		name: "Markdown checklist",
		description:
			"The - [ ] and - [x] lines of TODO.md. A ticked line counts as done. The text of a line is its id, so keep each line different. Needs jq on this computer.",
		command: `grep -n '^- \\[[ xX]\\] ' TODO.md | jq -R -s '[ split("\\n")[] | select(. != "") | capture("^(?<line>[0-9]+):- \\\\[(?<mark>[ xX])\\\\] (?<title>.*)$") | { id: .title, title, done: (.mark != " ") } ]'`,
	},
];
