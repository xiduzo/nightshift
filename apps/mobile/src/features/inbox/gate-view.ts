import type {
	ContextItem,
	GateChoice,
	GateLink,
	RunDetail,
} from "@nightshift/client";

/**
 * What the Gate screen shows, without React Native: where each choice
 * leads, which choices need a confirm, the parts of the question, and the
 * words after an answer went.
 */

/**
 * Where a choice leads, from the run's flow:
 * - `node`: the run goes on at that node.
 * - `end`: no edge leaves the Gate on it. The run ends.
 * - `limit`: the run took that path its most times. The run stops.
 */
export type ChoiceRoute =
	| { kind: "node"; nodeId: string; label: string }
	| { kind: "end" }
	| { kind: "limit" };

type FlowOfRun = Pick<RunDetail, "flow" | "traversals" | "steps">;

/**
 * The edge a run takes after `from` ends on `outcome`: the first edge (in
 * file order) on that outcome whose `max` is not reached. The engine's
 * rule, `nextEdge` of `@nightshift/flows`. Here again so the phone does
 * not bundle the flow package for ten lines.
 */
function nextEdge({
	flow,
	from,
	outcome,
	traversals,
}: {
	flow: RunDetail["flow"];
	from: string;
	outcome: string;
	traversals: Readonly<Record<string, number>>;
}):
	| { kind: "edge"; edge: RunDetail["flow"]["edges"][number] }
	| { kind: "end" }
	| { kind: "exhausted" } {
	const edges = flow.edges.filter(
		(edge) => edge.from === from && edge.outcome === outcome,
	);
	if (edges.length === 0) return { kind: "end" };
	const edge = edges.find(
		(candidate) =>
			candidate.max === undefined ||
			(traversals[candidate.id] ?? 0) < candidate.max,
	);
	return edge ? { kind: "edge", edge } : { kind: "exhausted" };
}

/**
 * Where each choice of a Gate leads, by choice name. Empty when the run is
 * not loaded, or when the Gate is in a flow that a Call step started: its
 * end goes back to that step, not out of the run.
 */
export function choiceRoutes(
	run: FlowOfRun | undefined,
	gate: { stepId: string; nodeId: string },
	choices: readonly Pick<GateChoice, "name">[],
	labels: ReadonlyMap<string, string>,
): Map<string, ChoiceRoute> {
	const routes = new Map<string, ChoiceRoute>();
	if (!run) return routes;
	const step = run.steps.find((one) => one.id === gate.stepId);
	if (step?.scope) return routes;
	if (!run.flow.nodes.some((node) => node.id === gate.nodeId)) return routes;
	for (const choice of choices) {
		const next = nextEdge({
			flow: run.flow,
			from: gate.nodeId,
			outcome: choice.name,
			traversals: run.traversals,
		});
		routes.set(
			choice.name,
			next.kind === "edge"
				? {
						kind: "node",
						nodeId: next.edge.to,
						label: labels.get(next.edge.to) ?? next.edge.to,
					}
				: next.kind === "end"
					? { kind: "end" }
					: { kind: "limit" },
		);
	}
	return routes;
}

/** The line under a choice: "Goes to Build", "Ends the run". */
export function routeText(route: ChoiceRoute | undefined): string | null {
	switch (route?.kind) {
		case "node":
			return `Goes to ${route.label}`;
		case "end":
			return "Ends the run";
		case "limit":
			return "This path reached its limit. The run stops.";
		default:
			return null;
	}
}

/** A choice the flow author colored red: it stops work. */
export function isDestructive(choice: Pick<GateChoice, "color">): boolean {
	return choice.color === "red";
}

/** The person confirms first: a red choice, or one that ends or stops the run. */
export function needsConfirm(
	choice: Pick<GateChoice, "color">,
	route: ChoiceRoute | undefined,
): boolean {
	return (
		isDestructive(choice) || route?.kind === "end" || route?.kind === "limit"
	);
}

/** What happens once the answer went: "Fix the bug goes on at Build". */
export function sentText(
	route: ChoiceRoute | undefined,
	runTitle: string,
	walkerElsewhere: string | null,
): string {
	if (route?.kind === "end") return "The run ends.";
	if (route?.kind === "limit") return "The run stops.";
	const goesOn =
		route?.kind === "node"
			? `${runTitle} goes on at ${route.label}`
			: `${runTitle} goes on`;
	return walkerElsewhere
		? `${goesOn} when ${walkerElsewhere} is online.`
		: `${goesOn}.`;
}

/** The longest text that shows as a tile under "At a glance". */
const GLANCE_MAX = 60;

/**
 * The parts of a Gate's question below its headline:
 * - `body`: the rest of the question, its paragraphs without a label.
 * - `glance`: short labelled values ("Branch: fix/login"), as tiles.
 * - `sections`: longer labelled text, and code, each under its label.
 */
export function questionSections(context: readonly ContextItem[]): {
	body: string[];
	glance: { label: string; value: string }[];
	sections: { label: string; kind: "text" | "code"; value: string }[];
} {
	const body: string[] = [];
	const glance: { label: string; value: string }[] = [];
	const sections: { label: string; kind: "text" | "code"; value: string }[] =
		[];
	for (const item of context) {
		if (item.kind === "code") {
			sections.push({
				label: item.label ?? "Code",
				kind: "code",
				value: item.value,
			});
		} else if (item.label === null) {
			body.push(item.value);
		} else if (item.value.length <= GLANCE_MAX && !item.value.includes("\n")) {
			glance.push({ label: item.label, value: item.value });
		} else {
			sections.push({ label: item.label, kind: "text", value: item.value });
		}
	}
	return { body, glance, sections };
}

/** "4 steps · 12 min · $0.40": the hint over "What happened". */
export function stepsHint(
	count: number,
	took: string | null,
	cost: string | null,
): string {
	return [count === 1 ? "1 step" : `${count} steps`, took, cost]
		.filter((part): part is string => part !== null && part !== "")
		.join(" · ");
}

/** What a link in a question is, in a word: "Pull request". */
export const LINK_WORD: Record<GateLink["kind"], string> = {
	pull: "Pull request",
	issue: "Issue",
	ticket: "Ticket",
	web: "Web page",
};

/** The button that opens a link: "Open on GitHub". */
export function openLinkText(link: Pick<GateLink, "url" | "kind">): string {
	if (link.kind === "pull" || link.kind === "issue") return "Open on GitHub";
	return "Open in the browser";
}
