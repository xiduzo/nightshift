import {
	FLOW_VERSION,
	type Flow,
	type FlowMigration,
	flowNameSchema,
	flowSchema,
	migrateFlow,
	type Profile,
	profileSchema,
	type Schedule,
	scheduleSchema,
	suffixedName,
} from "@nightshift/flows";
import { z } from "zod";
import type { ProfileStore } from "../device-config";
import {
	addNotices,
	type FlowDocument,
	flowSources,
	mark,
	marked,
	type NoticeKind,
	readSchedules,
	same,
	saveFlow,
	saveSchedules,
} from "./flow-document";
import {
	deleteLegacyFolder,
	LEGACY_FOLDER,
	type LegacyFolder,
	readLegacyFolder,
	type TrackedState,
} from "./legacy-folder";
import { parseLegacyProfiles } from "./legacy-profiles";

/**
 * The import on upgrade (ADR 2, decision 8; ADR 3, decision 4): once per
 * Clone, the flows, schedules and profiles of its `.nightshift/` folder
 * go into the Project's flow document and this Device's profiles. Then
 * Night Shift never reads the folder again.
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

/** The meta key that says the import of a Clone is done. */
export function importMarker(cloneId: string): string {
	return `imported:${cloneId}`;
}

export type CloneImportInput = {
	document: FlowDocument;
	/** The Clone: its row id, and its folder on this Device. */
	clone: { id: string; repoPath: string };
	/** This Device: where the import happens. */
	device: { id: string; name: string };
	/** How much of the folder git tracks. Throws when git cannot tell. */
	tracked(
		repoPath: string,
		folder: Pick<LegacyFolder, "files">,
	): Promise<TrackedState>;
	/** This Device's profiles. Without them, a folder with profiles stays. */
	profiles?: Pick<ProfileStore, "list" | "save"> | undefined;
	/**
	 * What brings a flow of format 6 to the current one on this Device
	 * (`FlowMigrations.forDevice`): read after the project's profiles came
	 * in. Without it, a node keeps its profile's name, to pick again.
	 */
	migration?: () => Promise<FlowMigration>;
	/** Flushes every document the import wrote: the folder goes only after it. */
	flush(): Promise<void>;
	at: number;
};

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

const schedulesFileSchema = z.object({
	version: z.literal(1),
	schedules: z.array(scheduleSchema).default([]),
});

/** Imports the Clone's folder, unless an import of this Clone is done. */
export async function importClone(
	input: CloneImportInput,
): Promise<CloneImport> {
	const { document, clone, device, at } = input;
	const marker = importMarker(clone.id);
	if (marked(document, marker)) return { status: "already" };

	const folder = await readLegacyFolder(clone.repoPath);
	if (folder === null) {
		await mark(document, marker, at);
		return { status: "no-folder" };
	}

	const problems: string[] = [];
	if (folder.unknown.length > 0) {
		problems.push("The folder holds other files.");
	}
	const notices: { kind: NoticeKind; message: string }[] = [];

	// Project profiles become this Device's.
	const madeProfiles: string[] = [];
	if (folder.profiles !== null) {
		const { profiles, issues } = parseLegacyProfiles(folder.profiles);
		if (issues.length > 0) {
			problems.push("Some of the project's profiles are not valid.");
		}
		if (profiles.length > 0 && !input.profiles) {
			problems.push("This computer cannot keep the project's profiles.");
		} else if (input.profiles) {
			const made = await importProfiles(input.profiles, profiles);
			madeProfiles.push(...made.made);
			if (made.made.length > 0) {
				notices.push({
					kind: "profiles-made",
					message: `Night Shift made ${made.made.length === 1 ? "this profile" : "these profiles"} on ${device.name} from the project's profiles: ${made.made.join(", ")}.`,
				});
			}
			for (const { name, label } of made.labelled) {
				notices.push({
					kind: "profiles-made",
					message: `${device.name} already has a profile named "${name}", so the project's one is now "${label}". The flows still use the one of ${device.name}.`,
				});
			}
		}
	}

	// The flows name this Device's profiles by id, the ones just made too.
	const migration = await input.migration?.();

	// Flows: those the document has with the same content come in once.
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
	const existing = flowSources(document);
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
			message: `Two flows are named "${name}". Night Shift imported the one from ${device.name} as "${next}".`,
		});
	}
	const nameOf = (name: string) => renamed.get(name) ?? name;

	// Schedules, with the flows they start under their new names.
	let schedules: Schedule[] = [];
	if (folder.schedules !== null) {
		const parsed =
			"json" in folder.schedules
				? schedulesFileSchema.safeParse(folder.schedules.json)
				: null;
		if (parsed?.success) schedules = parsed.data.schedules;
		else problems.push("The schedules are not valid.");
	}
	const current = readSchedules(document).schedules;
	const scheduleIds = new Set([
		...current.map((schedule) => schedule.id),
		...schedules.map((schedule) => schedule.id),
	]);
	const addedSchedules: Schedule[] = [];
	for (const schedule of schedules) {
		const moved: Schedule =
			schedule.flow === undefined
				? schedule
				: { ...schedule, flow: nameOf(schedule.flow) };
		const there = current.find((other) => other.id === schedule.id);
		if (there === undefined) {
			addedSchedules.push(moved);
			continue;
		}
		if (same(there, moved)) continue;
		const id = suffixedName(schedule.id, scheduleIds);
		scheduleIds.add(id);
		addedSchedules.push({ ...moved, id });
		notices.push({
			kind: "schedule-renamed",
			message: `Two schedules are named "${schedule.id}". Night Shift imported the one from ${device.name} as "${id}".${schedule.webhook ? " Its webhook address changed." : ""}`,
		});
	}

	// The flows, each with a revision of kind `import`.
	const saved: string[] = [];
	for (const [name, flow] of incoming) {
		if (known.has(name)) continue;
		await saveFlow(document, {
			name: nameOf(name),
			flow: withCalls(flow, renamed),
			kind: "import",
			personId: null,
			deviceId: device.id,
			at,
		});
		saved.push(nameOf(name));
	}
	if (addedSchedules.length > 0) {
		await saveSchedules(document, [...current, ...addedSchedules]);
	}

	let state: TrackedState | "unknown";
	try {
		state = await input.tracked(clone.repoPath, folder);
	} catch {
		state = "unknown";
	}
	const keep = problems.length > 0 || state !== "untracked";
	if (keep) {
		notices.push({
			kind: "folder-kept",
			message: keptMessage(device.name, state, problems),
		});
	}
	await mark(
		document,
		marker,
		at,
		notices.map((notice) => ({ ...notice, deviceId: device.id, at })),
	);
	// Everything is in the Replica before anything of the folder goes.
	await input.flush();

	let deleted = false;
	if (!keep) {
		deleted = await deleteLegacyFolder(clone.repoPath, folder).catch(
			() => false,
		);
		if (!deleted) {
			await addNotices(document, [
				{
					kind: "folder-kept",
					message: `Night Shift imported the ${LEGACY_FOLDER} folder on ${device.name}, but some of its files changed since. Night Shift left the folder in place. Remove it when you no longer need it.`,
					deviceId: device.id,
					at,
				},
			]);
		}
	}
	return {
		status: "imported",
		flows: saved,
		renamed: Object.fromEntries(renamed),
		profiles: madeProfiles,
		deleted,
	};
}

function keptMessage(
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

/** The same flow, whatever the order of its keys and its defaults. */
function sameFlow(stored: unknown, flow: Flow): boolean {
	const parsed = flowSchema.safeParse(stored);
	return (
		parsed.success &&
		same(
			plain({ ...parsed.data, version: FLOW_VERSION }),
			plain({ ...flow, version: FLOW_VERSION }),
		)
	);
}

/** The flow with its Subflow nodes calling the new names of renamed flows. */
function withCalls(flow: Flow, renamed: ReadonlyMap<string, string>): Flow {
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

/** The longest profile name (`nameSchema`). */
const MAX_PROFILE_NAME = 40;

/**
 * Gives the project's profiles to this Device. A profile it has already,
 * with the same settings, comes in once, also from an import that did not
 * end. Returns the labels it made, and the profiles that got another label.
 */
async function importProfiles(
	store: Pick<ProfileStore, "list" | "save">,
	profiles: readonly Profile[],
): Promise<{ made: string[]; labelled: { name: string; label: string }[] }> {
	const made: string[] = [];
	const labelled: { name: string; label: string }[] = [];
	for (const profile of profiles) {
		const list = store.list();
		const own = list.find((each) => each.name === profile.name);
		if (own === undefined) {
			const idTaken = list.some((each) => each.id === profile.name);
			await store.save(profile, idTaken ? undefined : profile.name);
			made.push(profile.name);
			continue;
		}
		if (sameProfile(own, profile)) continue;
		const base = `${profile.name}_project`;
		const copy = list.find(
			(each) => each.name.startsWith(base) && sameProfile(each, profile),
		);
		if (copy) continue;
		const label = freeLabel(base, new Set(list.map((each) => each.name)));
		await store.save({ ...profile, name: label });
		labelled.push({ name: profile.name, label });
	}
	return { made, labelled };
}

/** `base`, else `base_2`, `base_3`, …, each at most `MAX_PROFILE_NAME` long. */
function freeLabel(base: string, taken: ReadonlySet<string>): string {
	const first = base.slice(0, MAX_PROFILE_NAME);
	if (!taken.has(first)) return first;
	for (let n = 2; ; n++) {
		const suffix = `_${n}`;
		const label = `${base.slice(0, MAX_PROFILE_NAME - suffix.length)}${suffix}`;
		if (!taken.has(label)) return label;
	}
}

/** The same settings and description, whatever the label. */
function sameProfile(a: unknown, b: unknown): boolean {
	const left = profileSchema.safeParse({ ...(a as object), name: "x" });
	const right = profileSchema.safeParse({ ...(b as object), name: "x" });
	return left.success && right.success && same(left.data, right.data);
}

/** As JSON: without `undefined` fields. */
function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
