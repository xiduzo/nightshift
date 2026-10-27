import {
	diffFlows,
	type Flow,
	type FlowDiff,
	type FlowDiffSummary,
	type FlowIssue,
	type FlowListItem,
	flowDiffSummary,
	flowSchema,
	type LoadedFlow,
	listFlowSources,
	loadFlowSource,
	migrateFlow,
	type ProjectFlowMap,
	parsedFlows,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { FlowRevision, RevisionKind } from "./flow-document";
import type { ProjectFlows } from "./project-flows";

/**
 * The flows of a project in a Space as a Person lists, reads, saves and
 * deletes them, through the `ProjectFlows` port, and the revisions of each.
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
	};
}

function revisionNotFound(): Refusal {
	return new Refusal(
		"not-found",
		"This revision does not exist. Open the flow's revisions again.",
	);
}
