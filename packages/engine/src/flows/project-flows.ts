import type {
	Flow,
	FlowIssue,
	FlowPathOf,
	FlowSources,
	Schedule,
	ScheduleIssue,
} from "@nightshift/flows";
import {
	deleteFlowFile,
	flowFilePath,
	readFlowSources,
	readSchedulesFile,
	writeFlowFile,
	writeSchedulesFile,
} from "@nightshift/flows/files";

/**
 * Where the engine reads and saves the flows and the schedules of a
 * project: one port for every read and every save. The file adapter
 * (`fileProjectFlows`) keeps them in the Clone's `.nightshift/` folder.
 */

/** The project a read or a save is about, and who asks. */
export type FlowsOf = {
	projectId: string;
	/** The Space a Person asks in: a project of another Space is not found. */
	spaceId?: string;
	/** The Person who reads. */
	personId?: string | undefined;
};

/** The flows of a project as read: unparsed, with where each one is (`FlowFile.path`). */
export type ProjectFlowSet = {
	sources: FlowSources;
	pathOf: FlowPathOf;
};

/** The schedules of a project as read. */
export type ProjectSchedules = {
	/** Where the schedules are. */
	path: string;
	/** Empty when they do not load. */
	schedules: Schedule[];
	/** Problems of the whole (no `scheduleId`) and of each schedule. */
	issues: ScheduleIssue[];
};

export type ProjectFlows = {
	/** Every flow of the project. Throws for a project it cannot read. */
	flows(of: FlowsOf): Promise<ProjectFlowSet>;
	/** Saves a flow, a draft with errors too. Returns its issues. */
	save(of: FlowsOf, name: string, flow: Flow): Promise<FlowIssue[]>;
	/** Removes a flow. Refuses (`not-found`) a flow that does not exist. */
	remove(of: FlowsOf, name: string): Promise<void>;
	/** The project's schedules. `validate` (default true) checks each against the project's flows. */
	schedules(
		of: FlowsOf,
		options?: { validate?: boolean },
	): Promise<ProjectSchedules>;
	/** Saves the project's schedules, those with problems too. Returns the issues. */
	saveSchedules(
		of: FlowsOf,
		schedules: readonly Schedule[],
	): Promise<ScheduleIssue[]>;
};

export type FileProjectFlowsDeps = {
	/** The project in the Space, with its Clone here (`repoPath`) or null. Throws when it is not in the Space. */
	find(
		projectId: string,
		spaceId: string,
	): Promise<{ repoPath: string | null }>;
	/** The project with its Clone here. Throws without one. */
	get(projectId: string, spaceId?: string): Promise<{ repoPath: string }>;
	/** The flow files of a project without a Clone here, from another of the Person's Devices. */
	elsewhere(
		spaceId: string,
		projectId: string,
		personId: string | undefined,
	): Promise<FlowSources>;
};

/**
 * The flows and schedules in the Clone's `.nightshift/` folder. A Person
 * who reads in a Space without a Clone here reads the Clone of another of
 * their Devices. Every other read and every save needs the Clone here.
 */
export function fileProjectFlows(deps: FileProjectFlowsDeps): ProjectFlows {
	async function inClone(repoPath: string): Promise<ProjectFlowSet> {
		return {
			sources: await readFlowSources(repoPath),
			pathOf: (name) => flowFilePath(repoPath, name),
		};
	}

	const repoPath = async ({ projectId, spaceId }: FlowsOf) =>
		(await deps.get(projectId, spaceId)).repoPath;

	return {
		async flows({ projectId, spaceId, personId }) {
			if (spaceId === undefined) {
				return inClone((await deps.get(projectId)).repoPath);
			}
			const row = await deps.find(projectId, spaceId);
			if (row.repoPath !== null) return inClone(row.repoPath);
			return {
				sources: await deps.elsewhere(spaceId, projectId, personId),
				pathOf: (name) => flowFilePath("", name),
			};
		},

		async save(of, name, flow) {
			return writeFlowFile(await repoPath(of), name, flow);
		},

		async remove(of, name) {
			await deleteFlowFile(await repoPath(of), name);
		},

		async schedules(of, options = {}) {
			return readSchedulesFile(await repoPath(of), options);
		},

		async saveSchedules(of, schedules) {
			return writeSchedulesFile(await repoPath(of), schedules);
		},
	};
}
