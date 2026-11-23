/** The task of a suggestion for a node's prompt, whole or one selected part. */
import { type KindPrompt, quoted } from "./kind";

const SELECTION_START = "⟦SELECTION⟧";
const SELECTION_END = "⟦/SELECTION⟧";

export const promptKind: KindPrompt = {
	what: "a prompt",
	task: ({ request, node }) => {
		const current = (node as { prompt?: string }).prompt ?? "";
		const what =
			node.type === "decision"
				? node.by === "person"
					? "the question a person answers to pick one of the node's options"
					: "the question a model reads to pick one of the node's options"
				: node.type === "value"
					? "the brief a model reads to make the node's value"
					: "the message to the coding agent that runs this step";
		const lines = [
			`Write the node's prompt: ${what}.`,
			"",
			"Rules:",
			"- Keep every `{{reference}}` the current prompt has, unless the instruction says to drop it.",
			"- Use only the references listed above. Weave in the ones the instruction or the task implies, where the agent needs that value.",
			"- Write to the agent: plain, imperative sentences. Say what to do, with what, and what done looks like.",
			"- Do not invent file names, commands or tools: read the project when you need them.",
			"- Keep the language of the current prompt. A new prompt takes the language of the instruction.",
		];
		if (node.type === "agent" && node.output) {
			lines.push(
				"- The node has an output schema: say what the agent must report in it, by field.",
			);
		}
		if (node.type === "agent" && node.outcomes) {
			lines.push(
				`- Say when to end with each outcome: ${quoted(node.outcomes.map((o) => o.name))}.`,
			);
		}
		const { selection } = request;
		if (selection && selection.end > selection.start) {
			const start = Math.min(selection.start, current.length);
			const end = Math.min(selection.end, current.length);
			lines.push(
				"",
				`Rewrite only the part between ${SELECTION_START} and ${SELECTION_END}. \`text\` replaces that part, so it must fit the text around it. Leave out the markers.`,
				"",
				"The current prompt:",
				"```",
				current.slice(0, start) +
					SELECTION_START +
					current.slice(start, end) +
					SELECTION_END +
					current.slice(end),
				"```",
			);
		} else {
			lines.push(
				"",
				"`text` is the whole new prompt.",
				"",
				current.trim() === ""
					? "The node has no prompt yet."
					: ["The current prompt:", "```", current, "```"].join("\n"),
			);
		}
		return lines;
	},
};
