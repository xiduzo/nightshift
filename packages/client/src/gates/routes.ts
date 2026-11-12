import { nextEdge } from "@nightshift/flows";

import type { RunDetail } from "../runs";
import type { GateChoice } from "./types";

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
 * Where each choice of a Gate leads, by choice name, by the engine's own
 * edge rule (`nextEdge`). Empty when the run is not loaded, or when the
 * Gate is in a flow that a Call step started: its end goes back to that
 * step, not out of the run. The Gate of an Agent that asks a person: the
 * answer goes back to the agent (no route), and stop ends the step `fail`.
 */
export function choiceRoutes(
	run: FlowOfRun | undefined,
	gate: { stepId: string; nodeId: string },
	choices: readonly Pick<GateChoice, "name" | "needsNote">[],
	labels: ReadonlyMap<string, string>,
): Map<string, ChoiceRoute> {
	const routes = new Map<string, ChoiceRoute>();
	if (!run) return routes;
	const step = run.steps.find((one) => one.id === gate.stepId);
	if (step?.scope) return routes;
	const node = run.flow.nodes.find((one) => one.id === gate.nodeId);
	if (!node) return routes;
	const asks = node.type === "agent";
	for (const choice of choices) {
		if (asks && choice.needsNote) continue;
		const next = nextEdge({
			flow: run.flow,
			from: gate.nodeId,
			outcome: asks ? "fail" : choice.name,
			traversals: run.traversals,
		});
		const label = (id: string) => labels.get(id) ?? id;
		routes.set(
			choice.name,
			next.kind === "edge"
				? { kind: "node", nodeId: next.edge.to, label: label(next.edge.to) }
				: next.kind === "fan-out"
					? {
							// Several branches at once: the first names the route, the label all.
							kind: "node",
							nodeId: next.edges[0]?.to ?? "",
							label: next.edges.map((edge) => label(edge.to)).join(" and "),
						}
					: next.kind === "end"
						? { kind: "end" }
						: { kind: "limit" },
		);
	}
	return routes;
}

/**
 * Where a choice leads, in a few words: "Goes to Build", "Ends the run"
 * (the run finishes), "Stops the run" (the path reached its limit: the
 * run stops, and you can resume it).
 */
export function routeText(route: ChoiceRoute | undefined): string | null {
	switch (route?.kind) {
		case "node":
			return `Goes to ${route.label}`;
		case "end":
			return "Ends the run";
		case "limit":
			return "Stops the run";
		default:
			return null;
	}
}

/** Why a choice stops the run, under its card. */
export function routeNote(route: ChoiceRoute | undefined): string | null {
	return route?.kind === "limit" ? "This path reached its limit." : null;
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

/** The words of the confirm before a red choice, or one that ends or stops the run. */
export function confirmText(
	route: ChoiceRoute | undefined,
	choiceName: string,
	runTitle: string,
): { title: string; body: string } {
	switch (route?.kind) {
		case "end":
			return {
				title: "End the run?",
				body: `This answer ends the run ${runTitle}.`,
			};
		case "limit":
			return {
				title: "Stop the run?",
				body: `This path reached its limit. This answer stops the run ${runTitle}. You can resume it later.`,
			};
		case "node":
			return {
				title: `Send ${choiceName}?`,
				body: `${routeText(route)} in the run ${runTitle}.`,
			};
		default:
			return {
				title: `Send ${choiceName}?`,
				body: `The run ${runTitle} gets this answer.`,
			};
	}
}

/** What happens once the answer went: "Fix the bug continues at Build". */
export function sentText(
	route: ChoiceRoute | undefined,
	runTitle: string,
	walkerElsewhere: string | null,
): string {
	if (route?.kind === "end") return "The run ends.";
	if (route?.kind === "limit") return "The run stops.";
	const goesOn =
		route?.kind === "node"
			? `${runTitle} continues at ${route.label}`
			: `${runTitle} continues`;
	if (walkerElsewhere) return `${goesOn} when ${walkerElsewhere} is online.`;
	// A step label may end in its own mark: "Announce it?".
	return /[.?!]$/.test(goesOn) ? goesOn : `${goesOn}.`;
}
