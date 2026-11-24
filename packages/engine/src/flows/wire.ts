import type {
	AgentChoice,
	Flow,
	FlowIssue,
	FlowListItem,
	LoadedFlow,
	ProjectFlowMap,
} from "@nightshift/flows";
import type { Actor } from "../contract";
import type {
	FlowEditing,
	FlowRevisionItem,
	FlowRevisionView,
} from "./editing";
import type { FlowNotice } from "./store";
import type {
	FlowExport,
	FlowTransfer,
	SavedFlow,
	StarterImport,
} from "./transfer";

/**
 * What an import changes in the flows it saves: `agents` puts the
 * person's own profiles in place of the agents a flow names.
 */
export type FlowImportOptions = { agents?: readonly AgentChoice[] };

/** The flows of a Space's projects, as a Person sees them. */
export type SpaceFlows = {
	/** The project's flows, from its flow document: every Device has them, with or without a Clone. */
	list(projectId: string): Promise<FlowListItem[]>;
	get(projectId: string, name: string): Promise<LoadedFlow>;
	/** Every flow of a project by name: its flow, null when it does not load. One read for the editor. */
	map(projectId: string): Promise<ProjectFlowMap>;
	/** Saves drafts with errors too, as a new revision. Returns the issues of the saved flow. */
	save(projectId: string, name: string, flow: Flow): Promise<FlowIssue[]>;
	/** Removes the flow. Its revisions stay. */
	remove(projectId: string, name: string): Promise<void>;
	/** What a person must know about the project's flows, oldest first. */
	notices(projectId: string): Promise<FlowNotice[]>;
	/** Removes a notice, on every Device of the Space. */
	dismissNotice(projectId: string, noticeId: string): Promise<void>;
	/**
	 * The revisions of a flow, newest first: who saved each, when, on which
	 * Device, and what it changed from the one before.
	 */
	revisions(projectId: string, name: string): Promise<FlowRevisionItem[]>;
	/**
	 * One revision of a flow with its flow, and the diff to it from
	 * `against`: another revision, or the flow as it is now.
	 */
	revision(
		projectId: string,
		name: string,
		revisionId: string,
		against?: string,
	): Promise<FlowRevisionView>;
	/** Saves a revision's flow as the flow now: a new revision of kind `restore`. Returns its issues. */
	restore(
		projectId: string,
		name: string,
		revisionId: string,
	): Promise<FlowIssue[]>;
	/** The flow as a JSON file, in the form Night Shift saves it. Refuses a flow that is not valid. */
	export(projectId: string, name: string): Promise<FlowExport>;
	/**
	 * Saves the flow of a JSON file as a new flow of the project, a
	 * revision of kind `import`. An older format is brought up to date
	 * first. A name the project has already gets a suffix (`-2`).
	 */
	import(
		projectId: string,
		name: string,
		json: string,
		options?: FlowImportOptions,
	): Promise<SavedFlow>;
	/**
	 * Saves the starters that ship with Night Shift as flows of the
	 * project, each a revision of kind `import`. A starter whose name the
	 * project has already is skipped: its flow stays as it is, and no
	 * starter takes another name, as the starters call each other by name.
	 */
	importStarters(
		projectId: string,
		options?: FlowImportOptions,
	): Promise<StarterImport>;
	/**
	 * Copies the flow into a project of this Space as `to.name`, a
	 * revision of kind `copy` there. The flows it calls stay behind: the
	 * issues say which ones the copy misses. Refuses a name that project
	 * has already, and suggests a free one.
	 */
	copy(
		projectId: string,
		name: string,
		to: { projectId: string; name: string },
	): Promise<SavedFlow>;
};

/**
 * The flows of the projects of one Space as a Person lists, reads, saves,
 * deletes and moves them (`SpaceEngine.flows`): the use cases of
 * `editing/` and of `transfer/`, bound for a Space and the actor who
 * asks. Each checks the project is in the Space first: a project of
 * another Space is "not found", the same answer as one that does not
 * exist.
 */
export function wireFlows(deps: {
	editing: Omit<
		FlowEditing,
		"listKeptValues" | "resetKeptValue" | "listNodeMemory" | "forgetNodeMemory"
	>;
	transfer: Pick<
		FlowTransfer,
		"exportFlow" | "importFlow" | "importStarters" | "copyFlow"
	>;
}): (spaceId: string, actor: Actor) => SpaceFlows {
	const { editing, transfer } = deps;
	return (spaceId, actor) => ({
		list: (projectId) => editing.listFlows(actor, { spaceId, projectId }),
		get: (projectId, name) =>
			editing.readFlow(actor, { spaceId, projectId, name }),
		map: (projectId) => editing.readFlowMap(actor, { spaceId, projectId }),
		save: (projectId, name, flow) =>
			editing.saveFlow(actor, { spaceId, projectId, name, flow }),
		remove: (projectId, name) =>
			editing.removeFlow(actor, { spaceId, projectId, name }),
		notices: (projectId) =>
			editing.listFlowNotices(actor, { spaceId, projectId }),
		dismissNotice: (projectId, noticeId) =>
			editing.dismissFlowNotice(actor, { spaceId, projectId, noticeId }),
		revisions: (projectId, name) =>
			editing.listFlowRevisions(actor, { spaceId, projectId, name }),
		revision: (projectId, name, revisionId, against) =>
			editing.readFlowRevision(actor, {
				spaceId,
				projectId,
				name,
				revisionId,
				...(against !== undefined ? { against } : {}),
			}),
		restore: (projectId, name, revisionId) =>
			editing.restoreFlowRevision(actor, {
				spaceId,
				projectId,
				name,
				revisionId,
			}),
		export: (projectId, name) =>
			transfer.exportFlow(actor, { spaceId, projectId, name }),
		import: (projectId, name, json, options = {}) =>
			transfer.importFlow(actor, {
				spaceId,
				projectId,
				name,
				json,
				...(options.agents ? { agents: options.agents } : {}),
			}),
		importStarters: (projectId, options = {}) =>
			transfer.importStarters(actor, {
				spaceId,
				projectId,
				...(options.agents ? { agents: options.agents } : {}),
			}),
		copy: (projectId, name, to) =>
			transfer.copyFlow(actor, { spaceId, projectId, name, to }),
	});
}
