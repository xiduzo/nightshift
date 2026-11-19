import type { RunWalker } from "@nightshift/engine";
import { deviceNameIn, type SpaceDocuments } from "@nightshift/engine/projects";

/**
 * The Walkers of runs of a Space, as a run view names them: this
 * computer, else a Device by the name its row has, else the name the
 * Space document has for it.
 */
export function createWalkers(deps: {
	/** The names the Device rows give these Devices, by id. */
	names(ids: readonly string[]): Promise<Map<string, string>>;
	/** This computer as the Walker of its runs (`PeerContext.walkerId`). */
	walkerId(): Promise<string>;
	device: { id: string; name: string };
	documents: SpaceDocuments;
}) {
	const { device, documents } = deps;
	return async function walkers(
		spaceId: string,
		ids: readonly string[],
	): Promise<Map<string, RunWalker>> {
		const self = await deps.walkerId();
		const unique = [...new Set(ids)];
		const others = unique.filter((id) => id !== self && id !== device.id);
		const named = await deps.names(others);
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
