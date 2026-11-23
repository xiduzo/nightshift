import type { FlowMergePlan } from "../../store";
import type { Clock, DocumentMerges } from "./ports";

export type MergeFlowsPorts = {
	merges: Pick<DocumentMerges, "merge">;
	clock: Clock;
};

/**
 * Merges the flows of the Project `source`, their revisions and its
 * schedules into the flows of `destination`, now: both keep every flow
 * and every revision. Runs again safely. Returns what it renamed. A
 * Project that moved already merges too: it names documents, not
 * Projects of this Replica.
 */
export const mergeFlows =
	(ports: MergeFlowsPorts) =>
	(request: {
		source: string;
		destination: string;
		persons?: Readonly<Record<string, string>>;
	}): Promise<FlowMergePlan> =>
		ports.merges.merge(request.source, request.destination, {
			...(request.persons ? { persons: request.persons } : {}),
			at: ports.clock(),
		});
