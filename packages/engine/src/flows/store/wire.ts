import type {
	Flow,
	FlowIssue,
	FlowSources,
	Schedule,
	ScheduleIssue,
} from "@nightshift/flows";
import { now as timeNow } from "@nightshift/time";
import type { FlowDocuments } from "../../documents";
import type { FlowMigrations } from "../migrations";
import { yjsFlowStore } from "./adapters/out/yjs-flow-store";
import { dismissProjectFlowNotice } from "./application/dismiss-project-flow-notice";
import { keepFlowOutputTypes } from "./application/keep-flow-output-types";
import { keepFlowShapes } from "./application/keep-flow-shapes";
import { listProjectFlowNotices } from "./application/list-project-flow-notices";
import { listProjectFlowRevisions } from "./application/list-project-flow-revisions";
import type { FlowStore, ProjectSpaces, ThisDevice } from "./application/ports";
import { readProjectFlows } from "./application/read-project-flows";
import {
	type ProjectSchedules,
	readProjectSchedules,
} from "./application/read-project-schedules";
import { removeProjectFlow } from "./application/remove-project-flow";
import {
	type SaveFlowOptions,
	saveProjectFlow,
} from "./application/save-project-flow";
import { saveProjectSchedules } from "./application/save-project-schedules";
import { upgradeProjectFlows } from "./application/upgrade-project-flows";
import type { FlowRevision } from "./domain/flow-json";
import type { OutputType, StepShapes } from "./domain/inferred";
import type { FlowNotice } from "./domain/notices";

/**
 * The merge of one Project's flow documents into another's, as the store
 * does it: what the merge use cases of `flows/transfer/` call.
 */
export type FlowMerges = Pick<FlowStore, "planMerge" | "merge">;

/**
 * The flows of the Projects this Replica has, in their flow documents
 * (ADR 2): the one door the engine reads and changes them through. Every
 * read and save, the Flow revisions, the schedules, the notices and the
 * upgrade to a newer format. Every Device reads and saves them, with or
 * without a Clone of the project. The merge of one Project's flows into
 * another's is in `flows/transfer/`.
 *
 * It knows Projects, not Spaces: whether a Person may see a Project is
 * the check of the one who asks (`SpaceFlows`, for a Person in a Space).
 */
export type ProjectFlows = {
	/**
	 * Every flow of the project that this Night Shift reads, by name, with
	 * its Flow revision. A flow of an older format reads as the Device that
	 * saved it named its profiles and Devices.
	 */
	flows(projectId: string): Promise<FlowSources>;
	/** Saves a flow, a draft with errors too, as a new revision. Returns its issues. */
	save(
		projectId: string,
		name: string,
		flow: Flow,
		options?: SaveFlowOptions,
	): Promise<FlowIssue[]>;
	/** Removes a flow. Its revisions stay. Refuses (`not-found`) a flow that does not exist. */
	remove(projectId: string, name: string): Promise<void>;
	/**
	 * Keeps the shapes of a run's step on its node, as an output schema
	 * marked inferred, with one revision of kind `infer` by Night Shift on
	 * this Device. Only while the node has no schema, on a flow of this
	 * format: anything else writes nothing. The Walker calls it when a
	 * step ends with `shapes`. Returns whether it wrote a revision.
	 */
	keepShapes(
		projectId: string,
		name: string,
		node: { id: string; type: string },
		shapes: StepShapes,
	): Promise<boolean>;
	/**
	 * Keeps the types a run gave the outputs of the flow of that name, each
	 * marked inferred, with one revision of kind `infer` by Night Shift on
	 * this Device. Only on an output that has no type and the template the
	 * run read: anything else writes nothing. The Walker calls it when a Call
	 * of that flow finished. Returns whether it wrote a revision.
	 */
	keepOutputTypes(
		projectId: string,
		name: string,
		types: readonly OutputType[],
	): Promise<boolean>;
	/**
	 * The revisions of the flow of that name, oldest first. Empty for a
	 * flow that does not exist.
	 */
	revisions(projectId: string, name: string): Promise<FlowRevision[]>;
	/** The project's schedules. `validate` (default true) checks each against the project's flows. */
	schedules(
		projectId: string,
		options?: { validate?: boolean },
	): Promise<ProjectSchedules>;
	/** Saves the project's schedules, those with problems too. Returns the issues. */
	saveSchedules(
		projectId: string,
		schedules: readonly Schedule[],
	): Promise<ScheduleIssue[]>;
	/** What a person must know about the project's flows, oldest first. */
	notices(projectId: string): Promise<FlowNotice[]>;
	/** Removes a notice, on every Device of the Space. One that is gone already is no error. */
	dismissNotice(projectId: string, noticeId: string): Promise<void>;
	/**
	 * Brings the flows and the schedules of an older format of every
	 * Project whose Space this Replica keeps (`keeps`) to the current
	 * format, once (ADR 3, ADR 14): a flow with a revision of kind
	 * `upgrade` by Night Shift on this Device.
	 */
	upgrade(keeps: (spaceId: string) => Promise<boolean>): Promise<void>;
};

/**
 * The flows of the Projects over their flow documents: the Yjs
 * `FlowStore`, and the use cases of Night Shift bound to it. `merges`
 * gives the merge of the documents to `flows/transfer/`.
 */
export function wireStore(deps: {
	documents: Pick<FlowDocuments, "open" | "openAll">;
	/**
	 * The Project's Space. Throws (`not-found`) for a Project this Replica
	 * does not have, or one that is removed.
	 */
	project(projectId: string): Promise<{ spaceId: string }>;
	/** This Device: where a save happens. */
	deviceId: string | (() => Promise<string>);
	/** The clock of a revision. Default `now`. */
	now?: () => number;
	/**
	 * What brings a flow of an older format, a revision of it, and the
	 * schedules, to the current format. Without it, a node keeps its
	 * profile's name and the editor asks to pick the profile again, a
	 * Device name is to choose again, and nothing upgrades.
	 */
	migrations?: FlowMigrations;
}): ProjectFlows & { merges: FlowMerges } {
	const clock = deps.now ?? timeNow;
	const store = yjsFlowStore({
		documents: deps.documents,
		...(deps.migrations ? { migrations: deps.migrations } : {}),
	});
	const projects: ProjectSpaces = {
		spaceOf: async (projectId) => (await deps.project(projectId)).spaceId,
	};
	const { deviceId } = deps;
	const device: ThisDevice = {
		id: async () => (typeof deviceId === "string" ? deviceId : deviceId()),
	};
	const ports = { store, projects, device, clock };

	const flows = readProjectFlows(ports);
	const save = saveProjectFlow(ports);
	const remove = removeProjectFlow(ports);
	const keepShapes = keepFlowShapes(ports);
	const keepOutputTypes = keepFlowOutputTypes(ports);
	const revisions = listProjectFlowRevisions(ports);
	const schedules = readProjectSchedules(ports);
	const saveSchedules = saveProjectSchedules(ports);
	const notices = listProjectFlowNotices(ports);
	const dismissNotice = dismissProjectFlowNotice(ports);
	const upgrade = upgradeProjectFlows(ports);

	return {
		flows: (projectId) => flows({ projectId }),
		save: (projectId, name, flow, options = {}) =>
			save({ projectId, name, flow, ...options }),
		remove: (projectId, name) => remove({ projectId, name }),
		keepShapes: (projectId, name, node, shapes) =>
			keepShapes({ projectId, name, node, shapes }),
		keepOutputTypes: (projectId, name, types) =>
			keepOutputTypes({ projectId, name, types }),
		revisions: (projectId, name) => revisions({ projectId, name }),
		schedules: (projectId, options = {}) =>
			schedules({
				projectId,
				...(options.validate !== undefined
					? { validate: options.validate }
					: {}),
			}),
		saveSchedules: (projectId, list) =>
			saveSchedules({ projectId, schedules: list }),
		notices: (projectId) => notices({ projectId }),
		dismissNotice: (projectId, noticeId) =>
			dismissNotice({ projectId, noticeId }),
		// Without migrations nothing upgrades: no document is opened.
		upgrade: deps.migrations ? (keeps) => upgrade({ keeps }) : async () => {},
		merges: {
			planMerge: (source, destination, persons) =>
				store.planMerge(source, destination, persons),
			merge: (source, destination, merge) =>
				store.merge(source, destination, merge),
		},
	};
}
