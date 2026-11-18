/**
 * The tasks of the suggestions whose answer is a JSONata expression: the
 * rules of a Decision's options, and the expression of a Value node.
 */
import { json, type KindPrompt } from "./kind";

const RULE_SYNTAX = [
	'A rule is a JSONata expression over the run\'s values. It reads the names of the list above without the braces: a node id or an input name, then a path, such as `build.data.tests_passed = true and check.exit_code = 0`. Variables are `vars.<name>`. Put a name with a dash in backticks: `` `my-input` = "x" ``.',
	"A node that has not run yet reads as empty. Compare with `=`, `!=`, `<`, `>`, and join with `and` and `or`. `$exists(x)` checks a value is there.",
];

export const rulesKind: KindPrompt = {
	what: "rules",
	task: ({ node }) => {
		const options = node.type === "decision" ? node.options : [];
		return [
			"Write the rule of each of the Decision's options: the condition that picks it. Night Shift tries the rules from top to bottom and picks the first option whose rule holds.",
			"",
			...RULE_SYNTAX,
			"",
			"Each rule: `{ option, when }`, one per option, in the order of the options.",
			"- `option`: the option's name, exactly as below. Do not add or rename options.",
			'- `when`: the rule. Give the last option `""`: it is the default, picked when no rule holds.',
			"",
			"Rules:",
			"- Use only names the list above has, and the fields their data really has (see the output schemas in the flow).",
			"- Keep each rule short and readable.",
			"",
			"The options and their current rules:",
			json(options),
			"",
			"The node's note on what the rules check:",
			"```",
			(node as { prompt?: string }).prompt?.trim() || "(empty)",
			"```",
		];
	},
};

export const expressionKind: KindPrompt = {
	what: "an expression",
	task: ({ node }) => {
		const value = node.type === "value" ? node : null;
		return [
			"Write the Value node's expression: a JSONata expression whose result is the node's data. The result must match the node's output schema (below), or the step fails.",
			"",
			...RULE_SYNTAX,
			'JSONata can build objects and lists: `{ "title": plan.data.title }`, `$filter(plan.data.tasks, function($t) { $t.size = "small" })`, `$count(...)`, `$join(..., ", ")`.',
			"",
			"Rules:",
			"- Use only names the list above has, and the fields their data really has (see the output schemas in the flow).",
			"- Make the result fit the output schema exactly: its type and its required fields.",
			"",
			"The node's output schema:",
			json(value?.output ?? {}),
			"",
			value?.expression?.trim()
				? `The current expression:\n\`\`\`\n${value.expression}\n\`\`\``
				: "The node has no expression yet.",
		];
	},
};
