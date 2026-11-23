import {
	FLOW_VERSION,
	type Flow,
	type FlowMigration,
	type FlowSources,
	flowNameSchema,
	flowSchema,
	migrateFlow,
	profileSchema,
	type Schedule,
	scheduleSchema,
	suffixedName,
} from "@nightshift/flows";
import { z } from "zod";
import {
	LEGACY_FOLDER,
	type LegacyFolder,
	type TrackedState,
} from "./legacy-folder";

/**
 * The rules of the import on upgrade (ADR 2, decision 8; ADR 3, decision
 * 4): once per Clone, the flows, schedules and profiles of its
 * `.nightshift/` folder go into the Project's flow document and this
 * Device's profiles. Then Night Shift never reads the folder again.
 *
 * - A flow whose name the document has already: the same content comes
 *   in once; other content comes in under a suffixed name, and the
 *   folder's Subflow nodes and schedules follow the new name.
 * - A schedule whose id the document has already: the same.
 * - A project profile becomes a profile of this Device, with the
 *   profile's name as its id when no profile has it. A Device profile of
 *   that name wins: the project's comes in labelled `<name>_project`,
 *   and the flows keep naming the Device's own.
 * - The flows come in at the current format: a node that named a profile
 *   by its name names this Device's profile by its id (ADR 3), or the
 *   Device's profile its `device` names when this Device knows it.
 * - The folder goes only when git tracks none of it, everything in it
 *   came in and the documents are flushed. Else it stays, with a notice.
 *   A delete removes only the files the import read, unchanged.
 */

/** A Clone of this Device, with its Project's Space and its folder. */
export type CloneHere = {
	id: string;
	projectId: string;
	spaceId: string;
	repoPath: string;
};

/** The meta key that says the import of a Clone is done. */
export function importMarker(cloneId: string): string {
	return `imported:${cloneId}`;
}

/** What the import tells the people of the Project. */
export type ImportNoticeKind =
	| "profiles-made"
	| "flow-renamed"
	| "schedule-renamed"
	| "folder-kept";

export type ImportNotice = { kind: ImportNoticeKind; message: string };

/** What one import did. */
export type CloneImport =
	| { status: "already" }
	| { status: "no-folder" }
	| {
			status: "imported";
			/** The flows it saved, by the name they have now. */
			flows: string[];
			/** Flows that came in under another name: folder name → new name. */
			renamed: Record<string, string>;
			/** The profiles it made on this Device, by label. */
			profiles: string[];
			/** Whether the folder is gone. */
			deleted: boolean;
	  };

/** The notices of the profiles the import made, and of those it labelled. */
export function profileNotices(
	deviceName: string,
	made: { made: readonly string[]; labelled: readonly LabelledProfile[] },
): ImportNotice[] {
	const notices: ImportNotice[] = [];
	if (made.made.length > 0) {
		notices.push({
			kind: "profiles-made",
			message: `Night Shift made ${made.made.length === 1 ? "this profile" : "these profiles"} on ${deviceName} from the project's profiles: ${made.made.join(", ")}.`,
		});
	}
	for (const { name, label } of made.labelled) {
		notices.push({
			kind: "profiles-made",
			message: `${deviceName} already has a profile named "${name}". The project's profile is now "${label}". The flows still use the profile of ${deviceName}.`,
		});
	}
	return notices;
}

/** The folder's flows that read, at the current format, by name, sorted. Each other one is a problem. */
export function incomingFlows(
	folder: Pick<LegacyFolder, "flows">,
	migration: FlowMigration | undefined,
	problems: string[],
): Map<string, Flow> {
	const incoming = new Map<string, Flow>();
	for (const [name, source] of [...folder.flows].sort(([a], [b]) =>
		a < b ? -1 : 1,
	)) {
		if (!flowNameSchema.safeParse(name).success) {
			problems.push(`The name of the flow file "${name}" is not valid.`);
			continue;
		}
		const parsed =
			"json" in source
				? flowSchema.safeParse(migrateFlow(source.json, migration))
				: null;
		if (!parsed?.success) {
			problems.push(`The flow "${name}" is not valid.`);
			continue;
		}
		incoming.set(name, parsed.data);
	}
	return incoming;
}

/**
 * Which incoming flows the document has already with the same content
 * (`known`), and which come in under a suffixed name (`renamed`), with a
 * notice each.
 */
export function flowRenames(
	incoming: ReadonlyMap<string, Flow>,
	existing: FlowSources,
	deviceName: string,
	notices: ImportNotice[],
): { renamed: Map<string, string>; known: Set<string> } {
	const taken = new Set([...Object.keys(existing), ...incoming.keys()]);
	const renamed = new Map<string, string>();
	const known = new Set<string>();
	for (const [name, flow] of incoming) {
		const there = Object.hasOwn(existing, name) ? existing[name] : undefined;
		if (there === undefined) continue;
		if ("json" in there && sameFlow(there.json, flow)) {
			known.add(name);
			continue;
		}
		const next = suffixedName(name, taken);
		taken.add(next);
		renamed.set(name, next);
		notices.push({
			kind: "flow-renamed",
			message: `Two flows are named "${name}". Night Shift imported the one from ${deviceName} as "${next}".`,
		});
	}
	return { renamed, known };
}

/**
 * The schedules file of the folder: version 1. The import drops its
 * `device`: a schedule's runs run on the Replica that keeps the Space.
 */
const schedulesFileSchema = z.object({
	version: z.literal(1),
	schedules: z.array(z.unknown()).default([]),
});

/** The folder's schedules, or none and a problem when they do not read. */
export function folderSchedules(
	folder: Pick<LegacyFolder, "schedules">,
	problems: string[],
): Schedule[] {
	if (folder.schedules === null) return [];
	const parsed =
		"json" in folder.schedules
			? schedulesFileSchema.safeParse(folder.schedules.json)
			: null;
	const each = parsed?.success
		? parsed.data.schedules.map((json) => scheduleSchema.safeParse(json))
		: null;
	if (each?.every((one) => one.success)) {
		return each.flatMap((one) => (one.success ? [one.data] : []));
	}
	problems.push("The schedules are not valid.");
	return [];
}

/**
 * The schedules to add to `current`, with the flows they start under
 * their new names. One the document has already, the same, comes in
 * once. Another one of that id comes in under a suffixed id, with a
 * notice.
 */
export function schedulesToAdd(
	schedules: readonly Schedule[],
	current: readonly Schedule[],
	nameOf: (name: string) => string,
	deviceName: string,
	notices: ImportNotice[],
): Schedule[] {
	const scheduleIds = new Set([
		...current.map((schedule) => schedule.id),
		...schedules.map((schedule) => schedule.id),
	]);
	const added: Schedule[] = [];
	for (const schedule of schedules) {
		const moved: Schedule =
			schedule.flow === undefined
				? schedule
				: { ...schedule, flow: nameOf(schedule.flow) };
		const there = current.find((other) => other.id === schedule.id);
		if (there === undefined) {
			added.push(moved);
			continue;
		}
		if (sameJson(there, moved)) continue;
		const id = suffixedName(schedule.id, scheduleIds);
		scheduleIds.add(id);
		added.push({ ...moved, id });
		notices.push({
			kind: "schedule-renamed",
			message: `Two schedules are named "${schedule.id}". Night Shift imported the one from ${deviceName} as "${id}".${schedule.webhook ? " Its webhook address changed." : ""}`,
		});
	}
	return added;
}

/** Why the folder stays, when something kept it. */
export function keptMessage(
	deviceName: string,
	state: TrackedState | "unknown",
	problems: readonly string[],
): string {
	if (problems.length > 0) {
		return `Night Shift could not import all of the ${LEGACY_FOLDER} folder on ${deviceName}, so it left the folder in place. ${problems.join(" ")} Check those files, then remove the folder.`;
	}
	const imported = `Night Shift imported the ${LEGACY_FOLDER} folder on ${deviceName}.`;
	if (state === "tracked") {
		return `${imported} Git tracks that folder, so Night Shift left it in place. Remove it in a commit.`;
	}
	if (state === "partial") {
		return `${imported} Git tracks part of that folder, so Night Shift left it in place. Remove it in a commit.`;
	}
	return `${imported} Night Shift could not check the folder with git, so it left it in place. Remove the folder when you no longer need it.`;
}

/** Why the folder stays after all: a file changed since the import read it. */
export function changedSinceMessage(deviceName: string): string {
	return `Night Shift imported the ${LEGACY_FOLDER} folder on ${deviceName}, but some of its files changed since. Night Shift left the folder in place. Remove it when you no longer need it.`;
}

/** The same flow, whatever the order of its keys and its defaults. */
function sameFlow(stored: unknown, flow: Flow): boolean {
	const parsed = flowSchema.safeParse(stored);
	return (
		parsed.success &&
		sameJson(
			plain({ ...parsed.data, version: FLOW_VERSION }),
			plain({ ...flow, version: FLOW_VERSION }),
		)
	);
}

/** The flow with its Subflow nodes calling the new names of renamed flows. */
export function withCalls(
	flow: Flow,
	renamed: ReadonlyMap<string, string>,
): Flow {
	if (renamed.size === 0) return flow;
	return {
		...flow,
		nodes: flow.nodes.map((node) => {
			if (node.type !== "call") return node;
			const next = renamed.get(node.flow);
			return next === undefined ? node : { ...node, flow: next };
		}),
	};
}

/** A project profile that came in under another label. */
export type LabelledProfile = { name: string; label: string };

/** The longest profile name (`nameSchema`). */
const MAX_PROFILE_NAME = 40;

/** `base`, else `base_2`, `base_3`, …, each at most `MAX_PROFILE_NAME` long. */
export function freeLabel(base: string, taken: ReadonlySet<string>): string {
	const first = base.slice(0, MAX_PROFILE_NAME);
	if (!taken.has(first)) return first;
	for (let n = 2; ; n++) {
		const suffix = `_${n}`;
		const label = `${base.slice(0, MAX_PROFILE_NAME - suffix.length)}${suffix}`;
		if (!taken.has(label)) return label;
	}
}

/** The same settings and description, whatever the label. */
export function sameProfile(a: unknown, b: unknown): boolean {
	const left = profileSchema.safeParse({ ...(a as object), name: "x" });
	const right = profileSchema.safeParse({ ...(b as object), name: "x" });
	return left.success && right.success && sameJson(left.data, right.data);
}

/** As JSON: without `undefined` fields. */
function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** The same JSON, whatever the order of the keys (as `same` of the flow store). */
export function sameJson(a: unknown, b: unknown): boolean {
	return stableJson(a) === stableJson(b);
}

/** The JSON of a value with the keys of each object sorted. */
function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, inner: unknown) =>
		inner !== null && typeof inner === "object" && !Array.isArray(inner)
			? Object.fromEntries(
					Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)),
				)
			: inner,
	);
}
