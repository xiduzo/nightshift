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
 * step, not out of the run.
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
