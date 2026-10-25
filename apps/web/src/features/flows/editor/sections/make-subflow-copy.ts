// The words of "Make subflow from section": one title and one description
// for each change and each blocker that `planSubflowFromSection` in
// @nightshift/flows returns. The planner decides; this file only words it.
// Every switch is exhaustive: a new code fails the type check here.

import type {
	Flow,
	SubflowBlocker,
	SubflowChange,
	SubflowInputSource,
	SubflowReader,
} from "@nightshift/flows";
import {
	quotedList,
	sectionName,
	sectionProblemText,
} from "./section-problems";

export type SubflowText = { title: string; description: string };

/** What the words need besides the change: the flow as it is now. */
export type SubflowCopyContext = { flow: Pick<Flow, "sections" | "edges"> };

/** `a`, `a or b`, `a, b or c`: items already worded. */
function joined(items: readonly string[], word: "and" | "or"): string {
	const rest = [...items];
	const last = rest.pop() ?? "";
	return rest.length === 0 ? last : `${rest.join(", ")} ${word} ${last}`;
}

/** The verb for one subject or several: `reads` or `read`. */
function verb(count: number, one: string, many: string): string {
	return count === 1 ? one : many;
}

function plural(count: number, word: string): string {
	return `${count} ${count === 1 ? word : `${word}s`}`;
}

function sourceText(source: SubflowInputSource): string {
	switch (source.kind) {
		case "node":
			return `It gets {{${source.node}.${source.field}}} from this flow.`;
		case "input":
			return `It gets the input "${source.input}" of this flow.`;
		case "run":
			return `It gets {{run.${source.field}}} from this run.`;
		case "variable":
			return `It gets the value of the variable "${source.variable}" from this flow.`;
	}
}

function readerText(reader: SubflowReader): string {
	return "node" in reader
		? `"${reader.node}"`
		: `the output "${reader.output}"`;
}

/** `from "a" to "b"`, or the edge's id when the flow no longer has it. */
function edgeText(flow: Pick<Flow, "edges">, id: string): string {
	const edge = flow.edges.find((candidate) => candidate.id === id);
	return edge ? `from "${edge.from}" to "${edge.to}"` : `"${id}"`;
}

function sectionText(flow: Pick<Flow, "sections">, id: string): string {
	const section = flow.sections?.find((candidate) => candidate.id === id);
	return section ? sectionName(section) : `"${id}"`;
}

/** The words for one change of the plan. */
export function subflowChangeText(
	change: SubflowChange,
	{ flow }: SubflowCopyContext,
): SubflowText {
	switch (change.code) {
		case "nodes-moved":
			return {
				title: `Moves ${plural(change.nodes.length, "node")} to the new flow`,
				description: `${quotedList(change.nodes)} ${verb(change.nodes.length, "moves", "move")}. The new flow starts at "${change.entry}".`,
			};
		case "call-added":
			return {
				title: "Adds a Subflow",
				description: `A Subflow takes their place in this flow. It runs the new flow "${change.flow}".`,
			};
		case "start-moved":
			return {
				title: "Starts at the Subflow",
				description: `This flow started at "${change.from}". It starts at the Subflow now.`,
			};
		case "input-added": {
			const users = change.source.kind === "variable";
			return {
				title: `Input "${change.input}"`,
				description: `${sourceText(change.source)} ${quotedList(change.readBy)} ${
					users
						? verb(change.readBy.length, "uses", "use")
						: verb(change.readBy.length, "reads", "read")
				} it.`,
			};
		}
		case "output-added":
			return {
				title: `Output "${change.output}"`,
				description: `It gives {{${change.node}.${change.field}}} back to this flow. ${joined(
					change.readBy.map(readerText),
					"and",
				)} ${verb(change.readBy.length, "reads", "read")} it from the Subflow now.`,
			};
		case "variable-written-back":
			return {
				title: `Variable "${change.variable}"`,
				description: `${quotedList(change.writtenBy)} ${verb(change.writtenBy.length, "changes", "change")} it in the new flow. The Subflow writes the new value back to this flow.`,
			};
		case "exit-added":
			return {
				title: `Outcome "${change.label}"`,
				description: `When "${change.from}" ends on "${change.outcome}", the new flow ends on "${change.label}". This flow goes on to ${quotedList(change.to)}.`,
			};
		case "decision-added":
			return {
				title: "Adds a Decision by rule",
				description: `It comes after the Subflow. It reads how the new flow ended and picks the next node. Its options are ${quotedList(change.options)}.`,
			};
		case "ends-inside":
			return {
				title: "Where the run can end",
				description: `The run can end when ${joined(
					change.ends.map((end) => `"${end.node}" ends on "${end.outcome}"`),
					"or",
				)}. Then the new flow ends, and this flow ends after the Subflow.`,
			};
		case "section-removed":
			return {
				title: "Removes the Section",
				description: `The Section ${sectionText(flow, change.section)} goes from this flow. Its nodes are in the new flow.`,
			};
		case "restarts-on-resume":
			return {
				title: "A resume starts the Subflow again",
				description:
					"When a step in the Subflow fails, the run stops at the Subflow. When you resume the run, the Subflow starts again at its first node.",
			};
		case "reads-earlier-pass": {
			const read = [...new Set(change.reads.map((r) => r.reads))];
			return {
				title: "Values of an earlier pass are gone",
				description: `When the run comes back to this part, its steps start fresh. ${joined(
					change.reads.map((r) => `"${r.node}" reads "${r.reads}"`),
					"and",
				)}. ${quotedList(read)} may not have run yet in that pass.`,
			};
		}
		case "visit-per-call":
			return {
				title: "Visit counts start again",
				description: `${joined(
					change.reads.map(
						(r) => `"${r.node}" reads the visit count of "${r.reads}"`,
					),
					"and",
				)}. Each time the Subflow runs, the count starts at 1.`,
			};
		case "loop-limit-per-call":
			return {
				title: "Loop limits count per Subflow run",
				description: `The ${verb(change.edges.length, "edge", "edges")} ${joined(
					change.edges.map((id) => edgeText(flow, id)),
					"and",
				)} ${verb(change.edges.length, "has", "have")} a max. It counts each time the Subflow runs, not over the whole run.`,
			};
		case "session-per-call":
			return {
				title: "Agent sessions start new",
				description: `${quotedList(change.nodes)} ${verb(change.nodes.length, "continues", "continue")} the last session. Each time the Subflow runs, a new session starts.`,
			};
	}
}

/** The words for one blocker: what keeps the change from working, and what to change. */
export function subflowBlockerText(
	blocker: SubflowBlocker,
	{ flow }: SubflowCopyContext,
): SubflowText {
	switch (blocker.code) {
		case "section-not-found":
			return {
				title: "The Section is gone",
				description: "Close this and select a Section on the canvas.",
			};
		case "name-not-valid":
			return {
				title: "The name is not valid",
				description:
					"Use lowercase letters, digits and dashes. Start with a letter or a digit.",
			};
		case "name-taken":
			return {
				title: "The name is taken",
				description: `The project has a flow "${blocker.name}" already. Choose another name.`,
			};
		case "section-not-valid":
			return {
				title: "Change the Section first",
				description: blocker.problems
					.map((problem) => sectionProblemText(flow, problem))
					.join(" "),
			};
		case "flow-not-valid":
			return {
				title: "This flow has errors",
				description: `Fix the ${plural(blocker.errors, "error")} of this flow first. The issues list shows them.`,
			};
		case "stopped-edge": {
			const many = blocker.nodes.length > 1;
			return {
				title: "An edge on stopped",
				description: `${quotedList(blocker.nodes)} ${many ? "go" : "goes"} on along a "stopped" edge. In a Subflow, the run stops at the Subflow instead. Remove the edge, or move ${many ? "them" : "it"} out of the Section.`,
			};
		}
		case "calls-new-flow":
			return {
				title: "The name is used inside",
				description: `${quotedList(blocker.nodes)} ${verb(blocker.nodes.length, "runs", "run")} a flow with this name already. Choose another name.`,
			};
		case "mixed-exit":
			return {
				title: `"${blocker.from}" on "${blocker.outcome}"`,
				description: `On "${blocker.outcome}", "${blocker.from}" has edges into the Section and out of it. An edge out has a max, so the new flow cannot pick between them. Move the next nodes all into the Section or all out, or remove the max.`,
			};
		case "rule-reads-outside": {
			const nodes = blocker.names.filter((name) => !name.startsWith("run."));
			const many = blocker.names.length > 1;
			return {
				title: `A rule of "${blocker.node}"`,
				description: `It reads ${quotedList(blocker.names)} from outside the Section. ${
					nodes.length > 0
						? `Read ${many ? "them" : "it"} in a template instead, or move ${quotedList(nodes)} into the Section.`
						: `Read ${many ? "them" : "it"} in a template instead.`
				}`,
			};
		}
		case "rule-reads-inside": {
			const many = blocker.names.length > 1;
			return {
				title: `A rule of "${blocker.node}"`,
				description: `It reads ${quotedList(blocker.names)} inside the Section. Read ${many ? "them" : "it"} in a template instead, or move "${blocker.node}" into the Section.`,
			};
		}
		case "loop-without-limit":
			return {
				title: "A loop without a limit",
				description: `A loop runs through this Section. ${
					blocker.edges.length > 0
						? `Only the ${verb(blocker.edges.length, "edge", "edges")} ${joined(
								blocker.edges.map((id) => edgeText(flow, id)),
								"and",
							)} inside it ${verb(blocker.edges.length, "has", "have")} a max.`
						: "No edge on it has a max."
				} Give an edge outside the Section a max.`,
			};
		case "result-not-valid":
			return {
				title:
					blocker.flow === "subflow"
						? "The new flow would not be valid"
						: "This flow would not be valid",
				description: `It would have ${plural(blocker.issues.length, "error")}. Change the Section, or make the Subflow by hand.`,
			};
	}
}
