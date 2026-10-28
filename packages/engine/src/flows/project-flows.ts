import type {
	Flow,
	FlowIssue,
	FlowPathOf,
	FlowSources,
	Schedule,
	ScheduleIssue,
} from "@nightshift/flows";
import type { FlowRevision, RevisionKind } from "./flow-document";

/**
 * Where the engine reads and saves the flows and the schedules of a
 * project: one port for every read and every save. The document adapter
 * (`documentProjectFlows`) keeps them in the project's flow document.
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

/** How a save records its revision. */
export type SaveFlowOptions = {
	/** Why the revision exists. Default `save`. */
	kind?: RevisionKind;
};

export type ProjectFlows = {
	/** Every flow of the project. Throws for a project it cannot read. */
	flows(of: FlowsOf): Promise<ProjectFlowSet>;
	/** Saves a flow, a draft with errors too, as a new revision. Returns its issues. */
	save(
		of: FlowsOf,
		name: string,
		flow: Flow,
		options?: SaveFlowOptions,
	): Promise<FlowIssue[]>;
	/**
	 * The revisions of the flow of that name, oldest first. Empty for a
	 * flow that does not exist.
	 */
	revisions(of: FlowsOf, name: string): Promise<FlowRevision[]>;
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
