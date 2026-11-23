import type { FlowMergePlan } from "../../store";
import type { DocumentMerges } from "./ports";

export type PlanFlowMergePorts = {
	merges: Pick<DocumentMerges, "planMerge">;
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
