import { hostAnswerCosts } from "./host-answer-costs";
import { hostArchive } from "./host-archive";
import type { HostExchangeDeps } from "./host-deps";
import { hostLeases } from "./host-leases";
import { hostRunDoor } from "./host-run-door";
import { hostSpaceAsks } from "./host-space-asks";
import { hostSync } from "./host-sync";
import { hostWork } from "./host-work";
import type { HostExchange } from "./types";

/**
 * This computer as the Host of run history for its paired Devices: what
 * the Host's router (`hostRouter`) calls for `sync.*`, `archive.*` and
 * the work relay. Every call comes as its Caller, the Device key the Host
 * admitted once (`Devices.admit`); the Host answers it in the name of the
 * Caller's Person, and asks the Caller only what the procedure needs of
 * the Space: a role, a Membership.
 *
 * - It serves only rows of Spaces that Person is a Member of, and never a
 *   Device's own rows back to it. Its own Walker's rows are served the
 *   same way as the ones Devices pushed: its Replica keeps everything.
 * - It takes only a Device's own rows (the runs it walks), in Spaces its
 *   Person is a Member of. Anything else refuses the whole batch.
 * - Rows go out in the order they landed in this Host's Replica
 *   (`RunHistoryExchange.rowsAfter`), so a third Replica stores a moved
 *   run's events as they happened.
 * - A command needs the role that allows the action, checked by the
 *   engine (`host-run-door.ts`), as a start's role is. A run
 *   this Host walks gets it at once; any other waits for its Walker, which
 *   takes it on its own stream (`commands`), never behind rows. The other
 *   Devices of its Space's Members hear that it waits (`pending`), but not
 *   what it carries.
 * - The archive keeps what a Walker puts for its own runs, and gives a
 *   Member what it asks of their Spaces' runs: a copy of a step's file
 *   only when its stamp holds the step as this Host's log says.
 * - What the answers of Night Shift's own agents cost comes from the
 *   Device that answered, in its Person's name, and goes to every Member
 *   of its Space, for the Spaces this Host keeps (`answerCosts`).
 * - A Walker's paths (its worktree, its transcripts and logs on disk) stay
 *   with its owner's Replicas: the Host drops them from the rows of a
 *   Device of another Person before it keeps them, and from the rows it
 *   serves to a Device whose owner is not the Walker's
 *   (`withoutPrivatePaths`).
 */

/**
 * The Host of run history, one procedure group per file: run history and
 * Commands (`host-sync.ts`), what the answers cost
 * (`host-answer-costs.ts`), the asks of a Space (`host-space-asks.ts`), the
 * leases (`host-leases.ts`), the archive (`host-archive.ts`) and the work
 * relay (`host-work.ts`).
 */
export function createHostExchange(deps: HostExchangeDeps): HostExchange {
	const answerCosts = hostAnswerCosts(deps);
	const shared = { deps, door: hostRunDoor(deps.engine) };
	return {
		...hostSync(shared),
		...answerCosts,
		...hostLeases(deps),
		...hostSpaceAsks(shared),
		...hostArchive(deps),
		...hostWork(deps),
	};
}
