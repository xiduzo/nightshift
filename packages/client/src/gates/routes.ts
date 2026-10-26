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
