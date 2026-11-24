import {
	type createSpaceDocuments,
	memberRole,
	wireAccess,
	wireComputer,
} from "@nightshift/engine";

type AccessDeps = Parameters<typeof wireAccess>[0];
type SpaceDocuments = ReturnType<typeof createSpaceDocuments>;

/**
 * The access block of the daemon's composition (`daemon.ts`): who may act
 * in a Space, and on this computer, for the blocks that start before the
 * engine. It opens no run: the engine does.
 */
export function wireDaemonAccess(deps: {
	db: AccessDeps["members"]["db"];
	/** The Space documents: the Members a Command's Person is read from. */
	spaces: Pick<SpaceDocuments, "open">;
	/** The Person who owns this computer. */
	ownerId: string;
}) {
	const { openSpace } = wireAccess({
		log: {
			row: async () => {
				throw new Error("unused");
			},
			walkedHere: async () => false,
		},
		members: {
			db: deps.db,
			documentRole: async (spaceId, personId) =>
				memberRole(await deps.spaces.open(spaceId), personId),
		},
	});
	return {
		access: { openSpace },
		computerAccess: wireComputer({ id: () => deps.ownerId }),
	};
}
