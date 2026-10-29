import {
	FLOW_VERSION,
	type Flow,
	type FlowIssue,
	type FlowSources,
	flowNameSchema,
	migrateFlow,
	parsedFlows,
	parseFlow,
	type Schedule,
	type ScheduleIssue,
	scheduleFlowInfos,
	validateSchedules,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import {
	dismissNotice,
	type FlowDocuments,
	type FlowMergePlan,
	type FlowNotice,
	type FlowRevision,
	flowIdOf,
	flowNotices,
	flowRevisions,
	flowSources,
	mergeFlowDocuments,
	olderFormat,
	planFlowMerge,
	type RevisionKind,
	readSchedules,
	removeFlow,
	saveFlow,
	saveSchedules,
	upgradedSources,
	upgradeFlows,
} from "./flow-document";
import type { FlowMigrations } from "./flow-migration";

/**
 * The flows of the Projects this Replica has, in their flow documents
 * (ADR 2): the one module the engine reads and changes them through.
 * Every read and save, the Flow revisions, the schedules, the notices,
 * the upgrade to a newer format and the merge of one Project's flows
 * into another's. Every Device reads and saves them, with or without a
 * Clone of the project. The Yjs encoding stays in `flow-document.ts`.
 *
 * It knows Projects, not Spaces: whether a Person may see a Project is
 * the check of the one who asks (`SpaceFlows`, for a Person in a Space).
 */

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
	/** The Person who saves. None for Night Shift's own saves. */
	personId?: string | undefined;
};

export type ProjectFlows = {
	/**
	 * Every flow of the project that this Night Shift reads, by name, with
	 * its Flow revision. A flow of format 6 reads as the Device that saved
	 * it named its profiles.
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
	/** What a person must know about the project's flows (the import on upgrade), oldest first. */
	notices(projectId: string): Promise<FlowNotice[]>;
	/** Removes a notice, on every Device of the Space. One that is gone already is no error. */
	dismissNotice(projectId: string, noticeId: string): Promise<void>;
	/**
	 * Brings the flows of format 6 of every Project whose Space this
	 * Replica keeps (`keeps`) to the current format, once (ADR 3): a
	 * revision of kind `upgrade` by Night Shift on this Device.
	 */
	upgrade(keeps: (spaceId: string) => Promise<boolean>): Promise<void>;
	/**
	 * The names the flows of `source` and the ids its schedules take when
	 * they merge into `destination`, only those that change. Changes
	 * nothing: what a preview of the merge shows. `persons` gives a Person
	 * of the source their id in the destination.
	 */
	planMerge(
		source: string,
		destination: string,
		persons?: Readonly<Record<string, string>>,
	): Promise<FlowMergePlan>;
	/**
	 * Merges the flows of the Project `source`, their revisions and its
	 * schedules into the flows of `destination`: both keep every flow and
	 * every revision. Runs again safely. Returns what it renamed. A Project
	 * that moved already merges too: it names documents, not Projects of
	 * this Replica.
	 */
	merge(
		source: string,
		destination: string,
		options?: { persons?: Readonly<Record<string, string>> },
	): Promise<FlowMergePlan>;
};

export type ProjectFlowsDeps = {
	documents: Pick<FlowDocuments, "open" | "openAll">;
	/**
	 * The Project's Space. Throws (`not-found`) for a Project this Replica
	 * does not have, or one that is removed.
	 */
	project(projectId: string): Promise<{ spaceId: string }>;
	/** This Device: where a save happens. */
	deviceId: string | (() => Promise<string>);
	/** The clock of a revision. Default `Date.now`. */
	now?: () => number;
	/**
	 * What brings a flow of format 6, and a revision of it, to the current
	 * format. Without it, a node of format 6 keeps its profile's name and
	 * the editor asks to pick the profile again, and nothing upgrades.
	 */
	migrations?: FlowMigrations;
};

export function createProjectFlows(deps: ProjectFlowsDeps): ProjectFlows {
	const now = deps.now ?? Date.now;
	const { migrations } = deps;
	const documentOf = async (projectId: string) => {
		await deps.project(projectId);
		return deps.documents.open(projectId);
	};
	const deviceId = async () =>
		typeof deps.deviceId === "string" ? deps.deviceId : await deps.deviceId();

	return {
		async flows(projectId) {
			const document = await documentOf(projectId);
			return upgradedSources(document, migrations, await deviceId());
		},

		async save(projectId, name, flow, options = {}) {
			const valid = flowNameSchema.safeParse(name);
			if (!valid.success) {
				throw new Refusal(
					"invalid",
					`The flow name "${name}" is not valid. ${valid.error.issues[0]?.message ?? "Pick another name."}`,
				);
			}
			const document = await documentOf(projectId);
			await saveFlow(document, {
				name,
				flow,
				kind: options.kind ?? "save",
				personId: options.personId ?? null,
				deviceId: await deviceId(),
				at: now(),
			});
			const current: Flow = { ...flow, version: FLOW_VERSION };
			return parseFlow(current, {
				flows: parsedFlows(flowSources(document)),
				name,
			}).issues;
		},

		async remove(projectId, name) {
			await removeFlow(await documentOf(projectId), name);
		},

		async revisions(projectId, name) {
			const document = await documentOf(projectId);
			const flowId = flowIdOf(document, name);
			if (flowId === null) return [];
			const revisions = flowRevisions(document, flowId);
			if (!migrations) return revisions;
			// A revision of format 6 reads as the Device that saved it named its profiles.
			return Promise.all(
				revisions.map(async (revision) =>
					olderFormat(revision.flow)
						? {
								...revision,
								flow: migrateFlow(
									revision.flow,
									await migrations.forDevice(revision.deviceId),
								) as FlowRevision["flow"],
							}
						: revision,
				),
			);
		},

		async schedules(projectId, options = {}) {
			const document = await documentOf(projectId);
			const { schedules, unreadable } = readSchedules(document);
			const issues: ScheduleIssue[] =
				unreadable > 0
					? [
							{
								severity: "warning",
								message:
									"A newer version of Night Shift saved some schedules. Update Night Shift to see them.",
							},
						]
					: [];
			if (options.validate !== false) {
				issues.push(
					...validateSchedules(
						schedules,
						scheduleFlowInfos(flowSources(document)),
					),
				);
			}
			return { path: "schedules", schedules, issues };
		},

		async saveSchedules(projectId, schedules) {
			const document = await documentOf(projectId);
			await saveSchedules(document, schedules);
			return validateSchedules(
				schedules,
				scheduleFlowInfos(flowSources(document)),
			);
		},

		async notices(projectId) {
			return flowNotices(await documentOf(projectId));
		},

		async dismissNotice(projectId, noticeId) {
			await dismissNotice(await documentOf(projectId), noticeId);
		},

		async upgrade(keeps) {
			if (!migrations) return;
			const self = await deviceId();
			for (const document of await deps.documents.openAll()) {
				const row = await deps.project(document.projectId).catch(() => null);
				if (!row || !(await keeps(row.spaceId))) continue;
				await upgradeFlows(document, { migrations, deviceId: self, at: now() });
			}
		},

		async planMerge(source, destination, persons = {}) {
			return planFlowMerge(
				await deps.documents.open(source),
				await deps.documents.open(destination),
				persons,
			);
		},

		async merge(source, destination, options = {}) {
			return mergeFlowDocuments(
				await deps.documents.open(source),
				await deps.documents.open(destination),
				{ ...(options.persons ? { persons: options.persons } : {}), at: now() },
			);
		},
	};
}
