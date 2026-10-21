import type { DeviceLinks, WorkHub } from "@nightshift/devices";
import type {
	DeviceDocument,
	Engine,
	SpaceDocuments,
} from "@nightshift/engine";

import type { Sync } from "../sync";
import type { Lease } from "./lease";

/**
 * What one daemon process keeps across `bun --hot` reloads. `bun --hot`
 * evaluates every module again on each reload, in the same process, and
 * keeps `globalThis`. `createDaemon` reads and writes these, so each piece
 * that must have one owner per process keeps it:
 *
 * - kept as it is: the lease, the Device and Space documents (one writer
 *   each), the relay, the work hub (a Device's stream outlives a reload),
 *   the listeners (Bun reloads a server of the same `id` in place);
 * - replaced, the old one stopped first: the engine (`dispose`), the
 *   scheduler (`abort`), the timers (`clearInterval`), the links (`close`).
 *
 * The names stay as they are: a running dev daemon reloads into new code
 * with the same names.
 */
export type HotRegistry = {
	nightshiftLease?: Lease;
	nightshiftDocument?: DeviceDocument;
	nightshiftSpaces?: SpaceDocuments;
	nightshiftSync?: Sync;
	nightshiftWork?: WorkHub;
	nightshiftEngine?: Engine;
	nightshiftScheduler?: AbortController;
	nightshiftFacts?: Timer;
	nightshiftPresence?: Timer;
	nightshiftLinks?: DeviceLinks;
	/** The stop of the newest daemon: the signal handlers call it. */
	nightshiftStop?: () => Promise<void>;
};

export const hot = globalThis as HotRegistry;
