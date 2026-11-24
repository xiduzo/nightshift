import {
	SCHEDULES_VERSION,
	type Schedule,
	scheduleSchema,
} from "@nightshift/flows";
import type { FlowDocument } from "../../../../documents";
import { same } from "../../domain/flow-json";
import {
	applyOrder,
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

/**
 * The schedules of the document that this Night Shift reads, in their
 * order, and whether it holds others.
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
 * Saves the schedules: only those that differ. One that this Night Shift
 * does not read stays.
 */
export async function saveSchedules(
	document: FlowDocument,
	schedules: readonly Schedule[],
): Promise<void> {
	const maps = mapsOf(document);
	await document.current.change(() => {
		if (maps.meta.get(SCHEDULES_VERSION_KEY) !== SCHEDULES_VERSION) {
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
