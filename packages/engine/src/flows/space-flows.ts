import {
	canonicalFlowJson,
	diffFlows,
	FLOW_VERSION,
	type Flow,
	type FlowDiff,
	type FlowDiffSummary,
	type FlowIssue,
	type FlowListItem,
	type FlowMigration,
	type FlowSources,
	flowDiffSummary,
	flowSchema,
	type LoadedFlow,
	listFlowSources,
	loadFlowSource,
	migrateFlow,
	type ProjectFlowMap,
	parsedFlows,
	suffixedName,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { FlowNotice, FlowRevision, RevisionKind } from "./flow-document";
import type { ProjectFlows } from "./project-flows";

/**
 * The flows of the projects of one Space as a Person lists, reads, saves
 * and deletes them (`SpaceEngine.flows`), through `ProjectFlows`. Also
 * their notices, their revisions, a restore, and the moves between
 * projects: export, import and copy. Every verb waits for the engine to
 * be ready and checks the project is in the Space, here and nowhere
 * else: a project of another Space is "not found", the same answer as
 * one that does not exist.
 */
export type SpaceFlowsDeps = {
	/** The engine is ready. */
	ready: Promise<unknown>;
	flows: ProjectFlows;
	/** The project, in the Space. Throws (`not-found`) for one of another Space. */
	project(projectId: string, spaceId: string): Promise<unknown>;
	/** The names of these Persons, by id. One without a name is missing. */
	personNames?: (
		ids: readonly string[],
	) => Promise<ReadonlyMap<string, string>>;
	/** The names of these Devices, by id. One without a name is missing. */
	deviceNames?: (
		ids: readonly string[],
	) => Promise<ReadonlyMap<string, string>>;
	/**
	 * What brings an imported file of format 6 to the current format: its
	 * nodes name the profiles of this Device, the one that imports it.
	 * Without it, a node keeps its profile's name, to pick again.
	 */
	migration?: () => Promise<FlowMigration>;
};

/** Who or what a revision names, with its name when known. */
export type RevisionName = { id: string; name: string | null };

/** One revision of a flow, as a Person lists it. */
export type FlowRevisionItem = {
	id: string;
	at: number;
	kind: RevisionKind;
	/** Who saved it. Null for one that no Person saved (an import on upgrade, a merge). */
	person: RevisionName | null;
	/** The Device it was saved on. */
	device: RevisionName;
	/** The flow is this revision now. */
	current: boolean;
	/** What it changed from the revision before. Null for the first, and when either does not read as a flow. */
	changes: FlowDiffSummary | null;
};

/** One revision with its flow, and how it differs from another flow. */
export type FlowRevisionView = {
	revision: FlowRevisionItem & {
		/** Null when it does not read as a flow. */
		flow: Flow | null;
	};
	/** What the revision is compared with: another revision, or the flow as it is now (`revisionId` null). */
	against: { revisionId: string | null; flow: Flow | null };
	/** From `against` to the revision. Null when either does not read as a flow. */
	diff: FlowDiff | null;
};

/** A flow as a file to save and import elsewhere. */
export type FlowExport = { fileName: string; json: string };

/** A flow that an import or a copy saved: its name there, and its problems. */
export type SavedFlow = { name: string; issues: FlowIssue[] };

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
	import(projectId: string, name: string, json: string): Promise<SavedFlow>;
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

const NO_NAMES = async () => new Map<string, string>();

/** A revision's flow as the schema reads it, or null. */
function revisionFlow(revision: FlowRevision): Flow | null {
	const parsed = flowSchema.safeParse(migrateFlow(revision.flow));
	return parsed.success ? parsed.data : null;
}

/** The flows of each Space, for the Person who asks (none for Night Shift itself). */
export function createSpaceFlows(
	deps: SpaceFlowsDeps,
): (spaceId: string, personId?: string) => SpaceFlows {
	const { flows } = deps;
	const personNames = deps.personNames ?? NO_NAMES;
	const deviceNames = deps.deviceNames ?? NO_NAMES;

	async function revisionsOf(projectId: string, name: string) {
		const [sources, revisions] = await Promise.all([
			flows.flows(projectId),
			flows.revisions(projectId, name),
		]);
		const source = sources[name];
		if (source === undefined) {
			throw new Refusal("not-found", `The flow "${name}" does not exist.`);
		}
		const current = "json" in source ? (source.revision ?? null) : null;
		const parsed = revisions.map(revisionFlow);
		const [persons, devices] = await Promise.all([
			personNames(
				revisions.flatMap((revision) =>
					revision.personId === null ? [] : [revision.personId],
				),
			),
			deviceNames(revisions.map((revision) => revision.deviceId)),
		]);
		const items = revisions.map((revision, index): FlowRevisionItem => {
			const before = index > 0 ? parsed[index - 1] : null;
			const after = parsed[index];
			return {
				id: revision.id,
				at: revision.at,
				kind: revision.kind,
				person:
					revision.personId === null
						? null
						: {
								id: revision.personId,
								name: persons.get(revision.personId) ?? null,
							},
				device: {
					id: revision.deviceId,
					name: devices.get(revision.deviceId) ?? null,
				},
				current: revision.id === current,
				changes:
					before && after ? flowDiffSummary(diffFlows(before, after)) : null,
			};
		});
		const currentFlow = loadFlowSource(sources, name).flow;
		return { items, flows: parsed, currentFlow };
	}

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

	return (spaceId, personId) => {
		/** The one check of every verb: the engine is ready, and the project is in this Space. */
		async function inSpace(projectId: string): Promise<void> {
			await deps.ready;
			await deps.project(projectId, spaceId);
		}

		return {
			async list(projectId) {
				await inSpace(projectId);
				return listFlowSources(await flows.flows(projectId));
			},

			async get(projectId, name) {
				await inSpace(projectId);
				return loadFlowSource(await flows.flows(projectId), name);
			},

			async map(projectId) {
				await inSpace(projectId);
				return parsedFlows(await flows.flows(projectId));
			},

			async save(projectId, name, flow) {
				await inSpace(projectId);
				return flows.save(projectId, name, flow, { personId });
			},

			async remove(projectId, name) {
				await inSpace(projectId);
				await flows.remove(projectId, name);
			},

			async notices(projectId) {
				await inSpace(projectId);
				return flows.notices(projectId);
			},

			async dismissNotice(projectId, noticeId) {
				await inSpace(projectId);
				await flows.dismissNotice(projectId, noticeId);
			},

			async revisions(projectId, name) {
				await inSpace(projectId);
				const { items } = await revisionsOf(projectId, name);
				return items.reverse();
			},

			async revision(projectId, name, revisionId, against) {
				await inSpace(projectId);
				const {
					items,
					flows: parsed,
					currentFlow,
				} = await revisionsOf(projectId, name);
				const index = items.findIndex((item) => item.id === revisionId);
				const item = items[index];
				if (item === undefined) throw revisionNotFound();
				const flow = parsed[index] ?? null;
				let base: Flow | null = currentFlow;
				if (against !== undefined) {
					const other = items.findIndex(
						(candidate) => candidate.id === against,
					);
					if (other === -1) throw revisionNotFound();
					base = parsed[other] ?? null;
				}
				return {
					revision: { ...item, flow },
					against: { revisionId: against ?? null, flow: base },
					diff: flow && base ? diffFlows(base, flow) : null,
				};
			},

			async restore(projectId, name, revisionId) {
				await inSpace(projectId);
				const revision = (await flows.revisions(projectId, name)).find(
					(candidate) => candidate.id === revisionId,
				);
				if (revision === undefined) throw revisionNotFound();
				const flow = revisionFlow(revision);
				if (flow === null) {
					throw new Refusal(
						"invalid",
						"This revision is not a valid flow, so you cannot restore it.",
					);
				}
				return flows.save(projectId, name, flow, {
					kind: "restore",
					personId,
				});
			},

			async export(projectId, name) {
				await inSpace(projectId);
				const flow = await validFlow(projectId, name);
				return { fileName: `${name}.json`, json: canonicalFlowJson(flow) };
			},

			async import(projectId, name, json) {
				await inSpace(projectId);
				const flow = importedFlow(json, await deps.migration?.());
				const free = suffixedName(name, namesOf(await flows.flows(projectId)));
				const issues = await flows.save(projectId, free, flow, {
					kind: "import",
					personId,
				});
				return { name: free, issues };
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

function revisionNotFound(): Refusal {
	return new Refusal(
		"not-found",
		"This revision does not exist. Open the flow's revisions again.",
	);
}
