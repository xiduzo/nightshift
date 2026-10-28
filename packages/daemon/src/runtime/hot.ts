import type { Database } from "@nightshift/db";
import type { KeptDevices } from "@nightshift/devices";
import type {
	DeviceDocument,
	FlowDocuments,
	GitHubClones,
	ProjectCopies,
	SpaceDocuments,
} from "@nightshift/engine";
import type { InAppChannel, Notifications } from "@nightshift/notifications";

import type { KeepAwake } from "../keep-awake";
import type { KeptSync } from "../sync";
import type { Lease } from "./lease";

/**
 * What one daemon process keeps across `bun --hot` reloads. `bun --hot`
 * evaluates every module again on each reload, in the same process, and
 * keeps `globalThis`. `createDaemon` reads and writes these, so each piece
 * that must have one owner per process keeps it:
 *
 * - kept as it is: the database client (one per database, so a reload
 *   leaks none), the lease, the Device, Space and flow documents (one writer
 *   each), the in-app channel (an open notification stream outlives a
 *   reload), the listeners (Bun reloads a server of the same `id` in
 *   place);
 * - kept and bound to the newest daemon: the relay (`keepSync`: its
 *   connections stay, and a new request meets the newest daemon's
 *   database, auth and Device keys);
 * - handed over: the devices (`startDevices` keeps one slot,
 *   `nightshiftDevices`: its engine lets go of its runs, and the work hub,
 *   the applied commands, the calls served for a Host, the Devices online
 *   and the pairings in progress go on);
 * - replaced, the old one stopped first: the notifier (`stop`), the
 *   keep-awake (`stop`), the scheduler (`abort`), the timers
 *   (`clearInterval`).
 *
 * The names stay as they are: a running dev daemon reloads into new code
 * with the same names.
 *
 * The kept documents are Yjs documents. A reload evaluates Yjs again too,
 * so the dev entry's preload (`apps/server/src/hot-preload.ts`) gives every
 * reload the one Yjs of the process: the new code reads them as its own.
 */
export type HotRegistry = KeptDevices &
	KeptSync & {
		/** The database clients of this process, by URL (`processDatabase`). */
		nightshiftDatabases?: Map<string, Database>;
		nightshiftLease?: Lease;
		nightshiftDocument?: DeviceDocument;
		nightshiftSpaces?: SpaceDocuments;
		nightshiftFlows?: FlowDocuments;
		nightshiftInApp?: InAppChannel;
		nightshiftNotifications?: Notifications;
		nightshiftKeepAwake?: KeepAwake;
		nightshiftScheduler?: AbortController;
		/** The clones from GitHub that run, and how the last ones ended. */
		nightshiftGitHubClones?: GitHubClones;
		nightshiftProjectCopies?: ProjectCopies;
		nightshiftFacts?: Timer;
		/** The stop of the newest daemon: the signal handlers call it. */
		nightshiftStop?: () => Promise<void>;
	};

export const hot = globalThis as HotRegistry;
