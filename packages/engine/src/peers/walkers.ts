import type { Database } from "@nightshift/db";
import type { RunLog } from "../log";
import { deviceNameIn, type SpaceDocuments } from "../projects";
import type { RunWalker } from "../read";
import { deviceNamesOf } from "./registry";

/**
 * The Walkers of runs of a Space, as a run view names them: this
 * computer, else a Device by the name its row has, else the name the
 * Space document has for it.
 */
export function createWalkers(deps: {
	db: Database;
	log: Pick<RunLog, "walkerId">;
	device: { id: string; name: string };
	documents: SpaceDocuments;
}) {
	const { db, device, documents } = deps;
	return async function walkers(
		spaceId: string,
		ids: readonly string[],
	): Promise<Map<string, RunWalker>> {
		const self = await deps.log.walkerId();
		const unique = [...new Set(ids)];
		const others = unique.filter((id) => id !== self && id !== device.id);
		const named = await deviceNamesOf(db, others);
		const document =
			others.length > 0 && others.some((id) => !named.has(id))
				? await documents.open(spaceId)
				: null;
		return new Map(
			unique.map((id) => [
				id,
				{
					id,
					name:
						id === self || id === device.id
							? device.name
							: (named.get(id) ??
								(document ? deviceNameIn(document, id) : null)),
					thisDevice: id === self || id === device.id,
				},
			]),
		);
	};
}
