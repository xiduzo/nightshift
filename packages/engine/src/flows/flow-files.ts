import {
	type Flow,
	type FlowIssue,
	type FlowListItem,
	type LoadedFlow,
	listFlowSources,
	loadFlowSource,
	type ProjectFlowMap,
	parsedFlows,
} from "@nightshift/flows";
import type { ProjectFlows } from "./project-flows";

/**
 * The flows of a project in a Space as a Person lists, reads, saves and
 * deletes them, through the `ProjectFlows` port.
 */
export type FlowFilesDeps = {
	flows: ProjectFlows;
};

export type FlowFiles = ReturnType<typeof createFlowFiles>;

export function createFlowFiles(deps: FlowFilesDeps) {
	return {
		async list(
			spaceId: string,
			projectId: string,
			personId: string | undefined,
		): Promise<FlowListItem[]> {
			const set = await deps.flows.flows({ projectId, spaceId, personId });
			return listFlowSources(set.sources, set.pathOf);
		},

		/** Every flow of the project by name: its flow, null when it does not load. */
		async map(
			spaceId: string,
			projectId: string,
			personId: string | undefined,
		): Promise<ProjectFlowMap> {
			const set = await deps.flows.flows({ projectId, spaceId, personId });
			return parsedFlows(set.sources);
		},

		async get(
			spaceId: string,
			projectId: string,
			name: string,
			personId: string | undefined,
		): Promise<LoadedFlow> {
			const set = await deps.flows.flows({ projectId, spaceId, personId });
			return loadFlowSource(set.sources, name, set.pathOf);
		},

		async save(
			spaceId: string,
			projectId: string,
			name: string,
			flow: Flow,
		): Promise<FlowIssue[]> {
			return deps.flows.save({ projectId, spaceId }, name, flow);
		},

		async remove(
			spaceId: string,
			projectId: string,
			name: string,
		): Promise<void> {
			await deps.flows.remove({ projectId, spaceId }, name);
		},
	};
}
