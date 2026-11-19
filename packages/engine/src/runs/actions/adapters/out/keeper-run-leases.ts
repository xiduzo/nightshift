import type { createLeaseKeeper } from "../../../../leases";
import type { RunLeases } from "../../application/ports";

/** The keeper of the leases (`leases/keeper.ts`), as much of it as a release needs. */
export type KeeperRunLeasesDeps = Pick<
	ReturnType<typeof createLeaseKeeper>,
	"release"
>;

/**
 * The leases of the runs this computer walks, over the lease keeper: the
 * Space's own store, or its Host. A Host that cannot be reached lets the
 * lease expire after its ttl.
 */
export function keeperRunLeases(keeper: KeeperRunLeasesDeps): RunLeases {
	return {
		release: (runId, names) => keeper.release(runId, names),
	};
}
