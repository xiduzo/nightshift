import { createHash } from "node:crypto";
import type { KnowledgeMap } from "./map";

/** How many projects' Maps stay drawn: a person looks at few, and each costs little memory. */
const KEPT_MAPS = 8;

/**
 * Each project's last Map, by what it was drawn from. The caller reads the cheap
 * parts each time and names them as `from`: everything the drawing depends on,
 * so a change, a person's "Not a topic" too, shows at the next draw. Two draws at
 * once of the same Map share one drawing. A drawing that fails is not kept.
 */
export function createMapMemo() {
	const kept = new Map<string, { key: string; map: Promise<KnowledgeMap> }>();
	return (
		projectId: string,
		from: unknown,
		draw: () => Promise<KnowledgeMap>,
	): Promise<KnowledgeMap> => {
		const key = createHash("sha256").update(JSON.stringify(from)).digest("hex");
		const known = kept.get(projectId);
		const entry = known?.key === key ? known : { key, map: draw() };
		// The latest at the end: the oldest goes first.
		kept.delete(projectId);
		kept.set(projectId, entry);
		for (const old of kept.keys()) {
			if (kept.size <= KEPT_MAPS) break;
			kept.delete(old);
		}
		entry.map.catch(() => {
			if (kept.get(projectId) === entry) kept.delete(projectId);
		});
		return entry.map;
	};
}

/** Each project's last Map, as `createMapMemo` keeps it. */
export type MapMemo = ReturnType<typeof createMapMemo>;
