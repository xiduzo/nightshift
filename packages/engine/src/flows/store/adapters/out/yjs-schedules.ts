import {
	SCHEDULES_VERSION,
	type Schedule,
	scheduleSchema,
} from "@nightshift/flows";
import type { FlowDocument } from "../../../../documents";
import { same } from "../../domain/flow-json";
import {
	applyOrder,
	type FlowMaps,
	keyedById,
	mapsOf,
	orderedKeys,
	plain,
} from "./yjs-flow-encoding";

/**
 * The schedules of a flow document: `schedules` (id → JSON) in the order
 * of `scheduleOrder`, of the format that `meta` names.
 */

/** The key in `meta` of the format of the document's schedules. */
const SCHEDULES_VERSION_KEY = "schedulesVersion";

/** The format of the document's schedules: 1 when `meta` does not say. */
function schedulesVersionOf(maps: FlowMaps): number {
	const version = maps.meta.get(SCHEDULES_VERSION_KEY);
	return typeof version === "number" ? version : 1;
}

/** Whether the document's schedules are of a format older than this Night Shift's. */
export function olderSchedules(document: FlowDocument): boolean {
	return schedulesVersionOf(mapsOf(document)) < SCHEDULES_VERSION;
}

/**
 * The schedules of the document that this Night Shift reads, in their
 * order, and whether it holds others. The schema drops a `device` of an
 * older format (ADR 15).
 */
export function readSchedules(document: FlowDocument): {
	schedules: Schedule[];
	unreadable: number;
} {
	const maps = mapsOf(document);
	const schedules: Schedule[] = [];
	let unreadable = 0;
	for (const key of orderedKeys(maps.schedules, maps.scheduleOrder)) {
		const parsed = scheduleSchema.safeParse(maps.schedules.get(key));
		if (parsed.success) schedules.push(parsed.data);
		else unreadable++;
	}
	return { schedules, unreadable };
}

/**
 * Brings the schedules of the document to the current format, once
 * (ADR 15: a schedule names no Device): reads them as `readSchedules`
 * does and saves them. A schedule this Night Shift does not read stays as
 * it is. Returns whether it changed the document.
 */
export async function upgradeSchedules(
	document: FlowDocument,
): Promise<boolean> {
	if (!olderSchedules(document)) return false;
	await saveSchedules(document, readSchedules(document).schedules);
	return true;
}

/**
 * Saves the schedules: only those that differ. One that this Night Shift
 * does not read stays. The document's schedules are of the current format
 * from then on: pass them as `readSchedules` reads them.
 */
export async function saveSchedules(
	document: FlowDocument,
	schedules: readonly Schedule[],
): Promise<void> {
	const maps = mapsOf(document);
	await document.current.change(() => {
		if (schedulesVersionOf(maps) < SCHEDULES_VERSION) {
			maps.meta.set(SCHEDULES_VERSION_KEY, SCHEDULES_VERSION);
		}
		const keyed = keyedById(schedules);
		const wanted = new Map(keyed);
		const kept: string[] = [];
		for (const key of orderedKeys(maps.schedules, maps.scheduleOrder)) {
			if (wanted.has(key)) continue;
			if (scheduleSchema.safeParse(maps.schedules.get(key)).success) {
				maps.schedules.delete(key);
			} else {
				kept.push(key);
			}
		}
		for (const [key, schedule] of keyed) {
			if (!same(maps.schedules.get(key), schedule)) {
				maps.schedules.set(key, plain(schedule));
			}
		}
		applyOrder(maps.scheduleOrder, [...keyed.map(([key]) => key), ...kept]);
	});
}
