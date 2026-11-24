import {
	diffFlows,
	type Flow,
	type FlowDiff,
	type FlowDiffSummary,
	type FlowSources,
	flowDiffSummary,
	flowSchema,
	loadFlowSource,
	migrateFlow,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

/** A revision as the history of a flow reads it: who saved it, when, on which Device, why, and the flow. */
export type StoredRevision = {
	id: string;
	at: number;
	kind: string;
	personId: string | null;
	deviceId: string;
	flow: unknown;
};

/** Who or what a revision names, with its name when known. */
export type RevisionName = { id: string; name: string | null };

/** One revision of a flow, as a Person lists it. */
export type RevisionItem<Kind extends string = string> = {
	id: string;
	at: number;
	kind: Kind;
	/** Who saved it. Null for one that no Person saved (an upgrade, a merge). */
	person: RevisionName | null;
	/** The Device it was saved on. */
	device: RevisionName;
	/** The flow is this revision now. */
	current: boolean;
	/** What it changed from the revision before. Null for the first, and when either does not read as a flow. */
	changes: FlowDiffSummary | null;
};

/** One revision with its flow, and how it differs from another flow. */
export type RevisionView<Kind extends string = string> = {
	revision: RevisionItem<Kind> & {
		/** Null when it does not read as a flow. */
		flow: Flow | null;
	};
	/** What the revision is compared with: another revision, or the flow as it is now (`revisionId` null). */
	against: { revisionId: string | null; flow: Flow | null };
	/** From `against` to the revision. Null when either does not read as a flow. */
	diff: FlowDiff | null;
};

/** A revision's flow as the schema reads it, or null. */
export function revisionFlow(revision: { flow: unknown }): Flow | null {
	const parsed = flowSchema.safeParse(migrateFlow(revision.flow));
	return parsed.success ? parsed.data : null;
}

/** The refusal of a revision that a flow does not have. */
export function revisionNotFound(): Refusal {
	return new Refusal(
		"not-found",
		"This revision does not exist. Open the flow's revisions again.",
	);
}

/** The refusal of a restore of a revision that is not a valid flow. */
export function revisionNotValid(): Refusal {
	return new Refusal(
		"invalid",
		"This revision is not a valid flow, so you cannot restore it.",
	);
}

/** What a read of a flow's history asks for, as functions. */
export type HistoryReads<R extends StoredRevision> = {
	sources(): Promise<FlowSources>;
	revisions(): Promise<R[]>;
	persons(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
	devices(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
	/** The refusal of a flow that does not exist. */
	notFound(): Error;
};

/**
 * The history of the flow of that name, oldest first: each revision as a
 * Person lists it, its flow (null when it does not read as one), and the
 * flow as it is now. Refuses a flow that does not exist.
 */
export async function flowHistory<R extends StoredRevision>(
	name: string,
	read: HistoryReads<R>,
): Promise<{
	items: RevisionItem<R["kind"]>[];
	flows: (Flow | null)[];
	currentFlow: Flow | null;
}> {
	const [sources, revisions] = await Promise.all([
		read.sources(),
		read.revisions(),
	]);
	const source = sources[name];
	if (source === undefined) throw read.notFound();
	const current = "json" in source ? (source.revision ?? null) : null;
	const parsed = revisions.map(revisionFlow);
	const [persons, devices] = await Promise.all([
		read.persons(
			revisions.flatMap((revision) =>
				revision.personId === null ? [] : [revision.personId],
			),
		),
		read.devices(revisions.map((revision) => revision.deviceId)),
	]);
	const items = revisions.map((revision, index): RevisionItem<R["kind"]> => {
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

/**
 * One revision of a history with its flow, and the diff to it from
 * `against`: another revision, or the flow as it is now. Refuses a
 * revision the history does not have.
 */
export function revisionView<Kind extends string>(
	history: {
		items: RevisionItem<Kind>[];
		flows: (Flow | null)[];
		currentFlow: Flow | null;
	},
	revisionId: string,
	against: string | undefined,
): RevisionView<Kind> {
	const { items, flows: parsed, currentFlow } = history;
	const index = items.findIndex((item) => item.id === revisionId);
	const item = items[index];
	if (item === undefined) throw revisionNotFound();
	const flow = parsed[index] ?? null;
	let base: Flow | null = currentFlow;
	if (against !== undefined) {
		const other = items.findIndex((candidate) => candidate.id === against);
		if (other === -1) throw revisionNotFound();
		base = parsed[other] ?? null;
	}
	return {
		revision: { ...item, flow },
		against: { revisionId: against ?? null, flow: base },
		diff: flow && base ? diffFlows(base, flow) : null,
	};
}
