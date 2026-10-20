import type {
	Flow,
	FlowIssue,
	FlowListItem,
	LoadedFlow,
} from "@nightshift/flows";
import {
	deleteFlowFile,
	type FlowSources,
	listFlowFiles,
	listFlowSources,
	loadFlowSource,
	readFlowFile,
	writeFlowFile,
} from "@nightshift/flows/files";

/**
 * The flow files of a project in a Space: read from its Clone on this
 * computer, else from the Clone of another of the Person's Devices. A save
 * and a delete need the Clone here.
 */
export type FlowFilesDeps = {
	/** The project in the Space, with its Clone here (`repoPath`) or null. Throws when it is not in the Space. */
	find(
		projectId: string,
		spaceId: string,
	): Promise<{ repoPath: string | null }>;
	/** The project in the Space with its Clone here. Throws without one. */
	get(projectId: string, spaceId: string): Promise<{ repoPath: string }>;
	/** The flow files of a project without a Clone here, from another of the Person's Devices. */
	elsewhere(
		spaceId: string,
		projectId: string,
		personId: string | undefined,
	): Promise<FlowSources>;
};

export type FlowFiles = ReturnType<typeof createFlowFiles>;

export function createFlowFiles(deps: FlowFilesDeps) {
	return {
		async list(
			spaceId: string,
			projectId: string,
			personId: string | undefined,
		): Promise<FlowListItem[]> {
			const row = await deps.find(projectId, spaceId);
			if (row.repoPath !== null) return listFlowFiles(row.repoPath);
			return listFlowSources(
				await deps.elsewhere(spaceId, projectId, personId),
				"",
			);
		},

		async get(
			spaceId: string,
			projectId: string,
			name: string,
			personId: string | undefined,
		): Promise<LoadedFlow> {
			const row = await deps.find(projectId, spaceId);
			if (row.repoPath !== null) return readFlowFile(row.repoPath, name);
			return loadFlowSource(
				await deps.elsewhere(spaceId, projectId, personId),
				name,
				"",
			);
		},

		async save(
			spaceId: string,
			projectId: string,
			name: string,
			flow: Flow,
		): Promise<FlowIssue[]> {
			const row = await deps.get(projectId, spaceId);
			return writeFlowFile(row.repoPath, name, flow);
		},

		async remove(
			spaceId: string,
			projectId: string,
			name: string,
		): Promise<void> {
			const row = await deps.get(projectId, spaceId);
			await deleteFlowFile(row.repoPath, name);
		},
	};
}
