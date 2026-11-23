import type { SpaceDocuments } from "../documents";
import { yjsSpacePolicies } from "./adapters/out/yjs-space-policies";
import type { SpaceAccess } from "./application/ports";
import { readUsageAllowed } from "./application/read-usage-allowed";
import { setSpaceUsage } from "./application/set-space-usage";

/**
 * The wiring of spaces: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the package gives spaces: what the real adapters stand on. */
export type SpacesDeps = {
	access: SpaceAccess;
	/** The Space documents: each holds the policy of its Space. */
	documents: Pick<SpaceDocuments, "open" | "openAll">;
};

/** The use cases of spaces, bound to their ports. */
export type Spaces = {
	/** Turns anonymous usage on or off for a Space. */
	setSpaceUsage: ReturnType<typeof setSpaceUsage>;
	/** Says whether this computer may send anonymous usage. */
	readUsageAllowed: ReturnType<typeof readUsageAllowed>;
};

export function wireSpaces(deps: SpacesDeps): Spaces {
	const ports = {
		access: deps.access,
		spacePolicies: yjsSpacePolicies(deps.documents),
	};
	return {
		setSpaceUsage: setSpaceUsage(ports),
		readUsageAllowed: readUsageAllowed(ports),
	};
}
