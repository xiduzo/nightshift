/**
 * The task of a suggestion for a command: of a Command node, of a Wait
 * node, or the command that prints the list of a Call node. Its context is
 * the project's scripts.
 */
import {
	type CallEachNode,
	githubSubIssuesCommand,
	waitCommandOf,
} from "@nightshift/flows";
import { type KindPrompt, quoted } from "./kind";
import type { ProjectFacts } from "./project-facts";

function factsLines(facts: ProjectFacts | null): string[] {
	if (!facts) return ["Read the project to find its scripts."];
	const scripts = Object.entries(facts.scripts);
	return [
		facts.packageManager
			? `Package manager: ${facts.packageManager} (from its lock file). Run a script as \`${facts.packageManager} run <script>\`.`
			: "No lock file of a JavaScript package manager.",
		scripts.length > 0
			? [
					"The scripts of package.json:",
					...scripts.map(([name, script]) => `- \`${name}\`: \`${script}\``),
				].join("\n")
			: "No scripts in package.json.",
		facts.taskFiles.length > 0
			? `Other files with commands: ${quoted(facts.taskFiles)}. Read the one you need.`
			: "",
	].filter(Boolean);
}

/**
 * The task of a Call node's source command: a JSON array of items, the
 * item fields the engine reads, and the fields the called flow reads.
 * Two examples on GitHub show the item shape on a real tracker.
 */
function listCommandTask(
	node: CallEachNode,
	facts: ProjectFacts | null,
): string[] {
	const current =
		node.each.source.kind === "command" ? node.each.source.command : "";
	const as = node.each.as;
	return [
		`Write the command that prints the list of items. The node runs the flow \`${node.flow}\` once per item, and the item goes to its input \`${as}\`. The command runs with \`sh -c\` in the project's folder before each item, so items added during the run run too.`,
		"",
		"Rules:",
		"- Print one JSON array on stdout, nothing else. Each item is an object.",
		"- Give each item `id` (text, unique in the list) and `title`. Add `url` when the source has one.",
		"- Add `dependsOn` (a list of ids, or of `{ id, done }`) when the source knows what blocks an item: an item waits until those are done. Add `done: true` for an item that is finished: the node skips it.",
		`- Keep the fields the called flow reads. Run \`nightshift flows get ${node.flow}\` to read it, and look for \`{{${as}.<field>}}\`.`,
		"- Use the tracker this project uses. Check `git remote -v` and which CLI is installed: `gh`, `glab`, `acli`. A file of tasks in the project works too.",
		'- A `{{reference}}` reaches the shell as an environment variable, never as shell text: put it in double quotes, `--label "{{label}}"`.',
		"- Only read. Never change an issue, a file or git. Never ask for input or open a pager. You may run the command once to check what it prints.",
		"",
		"Two examples. The open GitHub issues with a label:",
		"```sh",
		`gh issue list --label ready --state open --limit 200 --json number,title,body,url,state --jq '[ .[] | { id: (.number | tostring), number, title, body, url, state } ]'`,
		"```",
		"The sub-issues of one GitHub issue, with their blocked-by links and the labels that count as done:",
		"```sh",
		githubSubIssuesCommand({ parent: "{{epic}}", doneLabels: ["implemented"] }),
		"```",
		"",
		"# The project",
		"",
		...factsLines(facts),
		"",
		current.trim() === ""
			? "The node has no command yet."
			: `The current command:\n\`\`\`sh\n${current}\n\`\`\``,
	];
}

export const commandKind: KindPrompt = {
	what: "a command",
	task: ({ node, facts }) => {
		if (node.type === "call" && node.each)
			return listCommandTask({ ...node, each: node.each }, facts);
		const wait = node.type === "wait";
		const polled = node.type === "wait" ? waitCommandOf(node.until) : null;
		const current =
			node.type === "command" ? node.command : (polled?.command ?? "");
		const lines = [
			wait
				? `Write the command a Wait node runs every ${polled?.everyMinutes ?? "few"} minutes until it exits 0. Exit 0 means the wait is over; any other code means try again later.`
				: "Write the Command node's command. It runs with `sh -c` in the project's folder, and its exit code picks the outcome.",
			"",
			"Rules:",
			"- Use the project's own scripts and tools (below). Do not invent a script or a program the project does not have.",
			'- A `{{reference}}` reaches the shell as an environment variable, never as shell text: put it in double quotes, `echo "{{plan.summary}}"`.',
			"- Never ask for input, never open an editor or a pager, and never change git history or delete files outside the project's build output.",
			"- Keep it to one line where you can. Chain steps with `&&`.",
		];
		if (node.type === "command") {
			lines.push(
				node.stdout === "json"
					? "- The node keeps the output as JSON: the command must print one JSON value on stdout."
					: "- Later nodes read the last lines of the output.",
				"",
				"The node's exits (the code, and the outcome it ends on):",
				...(node.exits ?? [{ name: "pass", code: 0 }, { name: "fail" }]).map(
					(exit) =>
						`- ${exit.code === undefined ? "any other code" : exit.code} → \`${exit.name}\`${exit.description ? `: ${exit.description}` : ""}`,
				),
			);
		}
		lines.push(
			"",
			"# The project",
			"",
			...factsLines(facts),
			"",
			current.trim() === ""
				? "The node has no command yet."
				: `The current command:\n\`\`\`sh\n${current}\n\`\`\``,
		);
		return lines;
	},
};
