import type { FlowMergePlan, FlowMerges } from "../../store";

export type PlanFlowMergePorts = {
	merges: Pick<FlowMerges, "planMerge">;
};

/**
 * The names the flows of `source` and the ids its schedules take when
 * they merge into `destination`, only those that change. Changes
 * nothing: what a preview of the merge shows. `persons` gives a Person
 * of the source their id in the destination.
 */
export const planFlowMerge =
	(ports: PlanFlowMergePorts) =>
	(request: {
		source: string;
		destination: string;
		persons?: Readonly<Record<string, string>>;
	}): Promise<FlowMergePlan> =>
		ports.merges.planMerge(
			request.source,
			request.destination,
			request.persons ?? {},
		);
