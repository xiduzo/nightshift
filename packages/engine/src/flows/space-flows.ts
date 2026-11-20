import {
	type AgentChoice,
	canonicalFlowJson,
	FLOW_VERSION,
	type Flow,
	type FlowIssue,
	type FlowListItem,
	type FlowMigration,
	type FlowSources,
	flowSchema,
	type LoadedFlow,
	loadFlowSource,
	migrateFlow,
	type ProjectFlowMap,
	starterList,
	suffixedName,
	withAgentProfiles,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { type Actor, personOf } from "../contract";
import type { UsageNotes } from "../usage";
import type {
	FlowEditing,
	FlowRevisionItem,
	FlowRevisionView,
} from "./editing";
import type { FlowNotice, ProjectFlows } from "./store";

/**
 * The flows of the projects of one Space as a Person lists, reads, saves
 * and deletes them (`SpaceEngine.flows`). The editing verbs are the use
 * cases of `editing/`. The moves between projects (export, import, copy)
 * stay here, over `ProjectFlows`, until lane F2 gives them their own.
 * Every verb waits for the engine to be ready and checks the project is
 * in the Space: a project of another Space is "not found", the same
 * answer as one that does not exist.
 */
export type SpaceFlowsDeps = {
	/** The engine is ready. */
	ready: Promise<unknown>;
	flows: ProjectFlows;
	/** What a Person does with the flows of a Space (`editing/`). */
	editing: Omit<
		FlowEditing,
		"listKeptValues" | "resetKeptValue" | "listNodeMemory" | "forgetNodeMemory"
	>;
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
	/** The project, in the Space. Throws (`not-found`) for one of another Space. */
	project(projectId: string, spaceId: string): Promise<unknown>;
	/**
	 * What brings an imported file of an older format to the current
	 * format: its nodes name the profiles of this Device, the one that
	 * imports it, and the Devices of the Space by id, the Person's own
	 * first. Without it, a node keeps its profile's name and its Device's
	 * name, to pick again.
	 */
	migration?: (scope: {
		spaceId: string;
		personId: string | null;
	}) => Promise<FlowMigration>;
};

export type { FlowRevisionItem, FlowRevisionView };

/** A flow as a file to save and import elsewhere. */
export type FlowExport = { fileName: string; json: string };

/** A flow that an import or a copy saved: its name there, and its problems. */
export type SavedFlow = { name: string; issues: FlowIssue[] };

/**
 * What an import changes in the flows it saves: `agents` puts the
 * person's own profiles in place of the agents a flow names.
 */
export type FlowImportOptions = { agents?: readonly AgentChoice[] };

/** What an import of the starters did: the names it saved, and the names the project had already. */
export type StarterImport = { imported: string[]; skipped: string[] };

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
	/** What a person must know about the project's flows (the import on upgrade), oldest first. */
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

/** The flows of each Space, for the actor who asks. */
export function createSpaceFlows(
	deps: SpaceFlowsDeps,
): (spaceId: string, actor: Actor) => SpaceFlows {
	const { flows, editing } = deps;

	/** The flow of that name, or a refusal when it does not read as a flow. */
	async function validFlow(projectId: string, name: string): Promise<Flow> {
		const loaded = loadFlowSource(await flows.flows(projectId), name);
		if (loaded.flow === null) {
			throw new Refusal(
				"invalid",
				`The flow "${name}" is not valid. Fix it in the editor first.`,
			);
		}
		return loaded.flow;
	}

	return (spaceId, actor) => {
		/** The Person who acts: none for Night Shift itself. */
		const personId = personOf(actor) ?? undefined;
		/** The one check of every verb: the engine is ready, and the project is in this Space. */
		async function inSpace(projectId: string): Promise<void> {
			await deps.ready;
			await deps.project(projectId, spaceId);
		}

		return {
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

			async export(projectId, name) {
				await inSpace(projectId);
				const flow = await validFlow(projectId, name);
				return { fileName: `${name}.json`, json: canonicalFlowJson(flow) };
			},

			async import(projectId, name, json, options = {}) {
				await inSpace(projectId);
				const flow = withAgentProfiles(
					importedFlow(
						json,
						await deps.migration?.({ spaceId, personId: personId ?? null }),
					),
					options.agents ?? [],
				);
				const free = suffixedName(name, namesOf(await flows.flows(projectId)));
				const issues = await flows.save(projectId, free, flow, {
					kind: "import",
					personId,
				});
				deps.usage?.note({ kind: "flow-created", from: "import" });
				return { name: free, issues };
			},

			async importStarters(projectId, options = {}) {
				await inSpace(projectId);
				const migration = await deps.migration?.({
					spaceId,
					personId: personId ?? null,
				});
				const taken = namesOf(await flows.flows(projectId));
				const result: StarterImport = { imported: [], skipped: [] };
				for (const starter of starterList()) {
					if (taken.has(starter.name)) {
						result.skipped.push(starter.name);
						continue;
					}
					await flows.save(
						projectId,
						starter.name,
						withAgentProfiles(
							migratedFlow(starter.source, migration),
							options.agents ?? [],
						),
						{ kind: "import", personId },
					);
					deps.usage?.note({
						kind: "flow-created",
						from: "starter",
						starter: starter.name,
					});
					result.imported.push(starter.name);
				}
				return result;
			},

			async copy(projectId, name, to) {
				await inSpace(projectId);
				await inSpace(to.projectId);
				const flow = await validFlow(projectId, name);
				const taken = namesOf(await flows.flows(to.projectId));
				if (taken.has(to.name)) {
					throw new Refusal(
						"conflict",
						`That project has a flow named "${to.name}" already. Copy it as "${suffixedName(to.name, taken)}" instead.`,
					);
				}
				const issues = await flows.save(to.projectId, to.name, flow, {
					kind: "copy",
					personId,
				});
				deps.usage?.note({ kind: "flow-created", from: "copy" });
				return { name: to.name, issues };
			},
		};
	};
}

function namesOf(sources: FlowSources): Set<string> {
	return new Set(Object.keys(sources));
}

/** The flow a JSON file holds, brought to the current format, or a refusal that says what is wrong. */
function importedFlow(json: string, migration?: FlowMigration): Flow {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Refusal(
			"invalid",
			"This file is not a flow. Choose a flow file that Night Shift exported.",
		);
	}
	return migratedFlow(parsed, migration);
}

/** A flow file's contents, brought to the current format, or a refusal that says what is wrong. */
function migratedFlow(parsed: unknown, migration?: FlowMigration): Flow {
	const migrated = migrateFlow(parsed, migration);
	const version =
		migrated !== null && typeof migrated === "object" && "version" in migrated
			? migrated.version
			: undefined;
	if (typeof version === "number" && version > FLOW_VERSION) {
		throw new Refusal(
			"invalid",
			"A newer version of Night Shift made this flow. Update Night Shift to import it.",
		);
	}
	const flow = flowSchema.safeParse(migrated);
	if (!flow.success) {
		const issue = flow.error.issues[0];
		const where =
			issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
		throw new Refusal(
			"invalid",
			`This file is not a valid flow${where}: ${issue?.message ?? "check its format"}. Choose a flow file that Night Shift exported.`,
		);
	}
	return flow.data;
}
