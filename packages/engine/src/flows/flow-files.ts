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
import type { FlowRevision, RevisionKind } from "./flow-document";
import type { ProjectFlows } from "./project-flows";

/**
 * The flows of a project in a Space as a Person lists, reads, saves and
 * deletes them, through the `ProjectFlows` port. Also their revisions,
 * a restore, and the moves between projects: export, import and copy.
 */
export type FlowFilesDeps = {
	flows: ProjectFlows;
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

export type FlowFiles = ReturnType<typeof createFlowFiles>;

const NO_NAMES = async () => new Map<string, string>();

/** A revision's flow as the schema reads it, or null. */
function revisionFlow(revision: FlowRevision): Flow | null {
	const parsed = flowSchema.safeParse(migrateFlow(revision.flow));
	return parsed.success ? parsed.data : null;
}

export function createFlowFiles(deps: FlowFilesDeps) {
	const personNames = deps.personNames ?? NO_NAMES;
	const deviceNames = deps.deviceNames ?? NO_NAMES;

	async function revisionsOf(
		spaceId: string,
		projectId: string,
		name: string,
		personId: string | undefined,
	) {
		const of = { projectId, spaceId, personId };
		const [set, revisions] = await Promise.all([
			deps.flows.flows(of),
			deps.flows.revisions(of, name),
		]);
		const source = set.sources[name];
		if (source === undefined) {
			throw new Refusal("not-found", `The flow "${name}" does not exist.`);
		}
		const current = "json" in source ? (source.revision ?? null) : null;
		const flows = revisions.map(revisionFlow);
		const [persons, devices] = await Promise.all([
			personNames(
				revisions.flatMap((revision) =>
					revision.personId === null ? [] : [revision.personId],
				),
			),
			deviceNames(revisions.map((revision) => revision.deviceId)),
		]);
		const items = revisions.map((revision, index): FlowRevisionItem => {
			const before = index > 0 ? flows[index - 1] : null;
			const after = flows[index];
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
		const currentFlow = loadFlowSource(set.sources, name, set.pathOf).flow;
		return { items, flows, currentFlow };
	}

	/** The flow of that name, or a refusal when it does not read as a flow. */
	async function validFlow(
		spaceId: string,
		projectId: string,
		name: string,
		personId: string | undefined,
	): Promise<Flow> {
		const set = await deps.flows.flows({ projectId, spaceId, personId });
		const loaded = loadFlowSource(set.sources, name, set.pathOf);
		if (loaded.flow === null) {
			throw new Refusal(
				"invalid",
				`The flow "${name}" is not valid. Fix it in the editor first.`,
			);
		}
		return loaded.flow;
	}

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
			personId?: string,
		): Promise<FlowIssue[]> {
			return deps.flows.save({ projectId, spaceId, personId }, name, flow);
		},

		async remove(
			spaceId: string,
			projectId: string,
			name: string,
		): Promise<void> {
			await deps.flows.remove({ projectId, spaceId }, name);
		},

		/** The flow's revisions, newest first. */
		async revisions(
			spaceId: string,
			projectId: string,
			name: string,
			personId: string | undefined,
		): Promise<FlowRevisionItem[]> {
			const { items } = await revisionsOf(spaceId, projectId, name, personId);
			return items.reverse();
		},

		/**
		 * One revision of the flow with its flow, and the diff from
		 * `against` (another revision of the flow; the flow as it is now
		 * when left out) to it.
		 */
		async revision(
			spaceId: string,
			projectId: string,
			name: string,
			revisionId: string,
			against: string | undefined,
			personId: string | undefined,
		): Promise<FlowRevisionView> {
			const { items, flows, currentFlow } = await revisionsOf(
				spaceId,
				projectId,
				name,
				personId,
			);
			const index = items.findIndex((item) => item.id === revisionId);
			const item = items[index];
			if (item === undefined) throw revisionNotFound();
			const flow = flows[index] ?? null;
			let base: Flow | null = currentFlow;
			if (against !== undefined) {
				const other = items.findIndex((candidate) => candidate.id === against);
				if (other === -1) throw revisionNotFound();
				base = flows[other] ?? null;
			}
			return {
				revision: { ...item, flow },
				against: { revisionId: against ?? null, flow: base },
				diff: flow && base ? diffFlows(base, flow) : null,
			};
		},

		/** Saves a revision's flow as the flow now: a new revision of kind `restore`. Returns its issues. */
		async restore(
			spaceId: string,
			projectId: string,
			name: string,
			revisionId: string,
			personId: string | undefined,
		): Promise<FlowIssue[]> {
			const of = { projectId, spaceId, personId };
			const revision = (await deps.flows.revisions(of, name)).find(
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
			return deps.flows.save(of, name, flow, { kind: "restore" });
		},

		/** The flow as a JSON file, in the form Night Shift saves it. */
		async export(
			spaceId: string,
			projectId: string,
			name: string,
			personId: string | undefined,
		): Promise<FlowExport> {
			const flow = await validFlow(spaceId, projectId, name, personId);
			return { fileName: `${name}.json`, json: canonicalFlowJson(flow) };
		},

		/**
		 * Saves the flow of a JSON file as a new flow of the project, a
		 * revision of kind `import`. An older format is brought up to date
		 * first. A name the project has already gets a suffix (`-2`).
		 */
		async import(
			spaceId: string,
			projectId: string,
			name: string,
			json: string,
			personId: string | undefined,
		): Promise<SavedFlow> {
			const flow = importedFlow(json, await deps.migration?.());
			const of = { projectId, spaceId, personId };
			const set = await deps.flows.flows(of);
			const free = suffixedName(name, new Set(Object.keys(set.sources)));
			const issues = await deps.flows.save(of, free, flow, { kind: "import" });
			return { name: free, issues };
		},

		/**
		 * Copies the flow into a project of the Space, a revision of kind
		 * `copy` there. The flows it calls stay behind: the issues say which
		 * ones the copy misses. Refuses a name that project has already,
		 * and suggests a free one.
		 */
		async copy(
			spaceId: string,
			projectId: string,
			name: string,
			to: { projectId: string; name: string },
			personId: string | undefined,
		): Promise<SavedFlow> {
			const flow = await validFlow(spaceId, projectId, name, personId);
			const target = { projectId: to.projectId, spaceId, personId };
			const taken = new Set(
				Object.keys((await deps.flows.flows(target)).sources),
			);
			if (taken.has(to.name)) {
				throw new Refusal(
					"conflict",
					`That project has a flow named "${to.name}" already. Copy it as "${suffixedName(to.name, taken)}" instead.`,
				);
			}
			const issues = await deps.flows.save(target, to.name, flow, {
				kind: "copy",
			});
			return { name: to.name, issues };
		},
	};
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
