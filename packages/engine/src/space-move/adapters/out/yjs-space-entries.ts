import { now as timeNow } from "@nightshift/time";
import {
	cloneKey,
	projectClones,
	projectEntry,
	recordClone,
	type SpaceDocuments,
	type SpaceProject,
	spaceProjectSchema,
} from "../../../documents";
import type { SpaceEntries } from "../../application/ports";
import type { ProjectRow, ProjectTarget } from "../../domain/move";

/**
 * The Space documents of a move, over the Yjs documents this Replica
 * keeps. `wireSpaceMove` builds it.
 */
export function yjsSpaceEntries(
	documents: Pick<SpaceDocuments, "open" | "remove">,
): SpaceEntries {
	return {
		move: (move) => moveSpaceEntries(documents, move),
		forget: (spaceId) => documents.remove(spaceId),
	};
}

/**
 * The Space documents after a move of Projects moved their rows: a
 * document follows the rows. Only the documents this Replica writes
 * change: one a Host keeps takes the move from its Host.
 *
 * - The Space each Project goes to gets its entry, from the document it
 *   left (else from its row), and its Clones. A Project that maps onto
 *   another one there keeps that one's entry and gets its Clones.
 * - The Space they left loses their entries and their Clones.
 * - `onlyDevice`: a Device takes its own copy of the Projects (a split).
 *   Only its own Clones go along, and the Space they left keeps them.
 */
async function moveSpaceEntries(
	documents: Pick<SpaceDocuments, "open">,
	move: {
		from: string;
		projects: Readonly<Record<string, ProjectTarget>>;
		/** The moved Projects' rows as they were before the move. */
		rows: ReadonlyMap<string, ProjectRow>;
		onlyDevice?: string;
	},
): Promise<void> {
	const source = await documents.open(move.from);
	const pairs = Object.entries(move.projects);
	const clonesOf = (id: string) =>
		projectClones(source, id).filter(
			(c) => move.onlyDevice === undefined || c.deviceId === move.onlyDevice,
		);
	for (const spaceId of new Set(pairs.map(([, t]) => t.spaceId))) {
		const destination = await documents.open(spaceId);
		if (destination.hostedElsewhere) continue;
		const now = timeNow();
		await destination.change(() => {
			for (const [id, target] of pairs) {
				if (target.spaceId !== spaceId) continue;
				if (
					id === target.projectId ||
					!destination.projects.has(target.projectId)
				) {
					const parsed = spaceProjectSchema.safeParse(source.projects.get(id));
					const row = move.rows.get(id);
					const entry = parsed.success
						? parsed.data
						: row
							? projectEntry(row)
							: null;
					if (entry) {
						destination.projects.set(target.projectId, {
							...entry,
							updatedAt: now,
						} satisfies SpaceProject);
					}
				}
				for (const c of clonesOf(id)) {
					recordClone(destination, {
						projectId: target.projectId,
						deviceId: c.deviceId,
						deviceName: c.deviceName ?? c.deviceId,
					});
				}
			}
		});
	}
	if (source.hostedElsewhere || move.onlyDevice !== undefined) return;
	const ids = pairs.map(([id]) => id);
	if (!ids.some((id) => source.projects.has(id) || clonesOf(id).length > 0)) {
		return;
	}
	await source.change(() => {
		for (const id of ids) {
			for (const c of clonesOf(id))
				source.clones.delete(cloneKey(id, c.deviceId));
			source.projects.delete(id);
		}
	});
}
