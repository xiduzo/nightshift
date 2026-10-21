import type { Database } from "@nightshift/db";

import { hot } from "./hot";
import {
	acquireLease,
	LEASE_HEARTBEAT_MS,
	type Lease,
	LeaseHeldError,
} from "./lease";

/**
 * One daemon per database: take the lease before the engine recovers
 * interrupted work or the scheduler starts. Another live daemon on this
 * database stops this one here (exit code 1). A daemon that loses the lease
 * later (its machine slept past the stale window and another daemon
 * started) fences itself: it exits with code 3 and writes nothing more.
 *
 * `bun --hot` evaluates the daemon again on each reload, in the same
 * process: this keeps the lease the process holds.
 */
export async function holdLease(db: Database): Promise<Lease> {
	hot.nightshiftLease ??= await takeLease(db);
	return hot.nightshiftLease;
}

async function takeLease(db: Database): Promise<Lease> {
	let lease: Lease;
	try {
		lease = await acquireLease({
			db,
			onLost: (reason) => {
				console.error(
					`SELF-FENCE: ${reason} Another daemon holds this database now. Exiting without writing anything more.`,
				);
				process.exit(3);
			},
		});
	} catch (error) {
		if (!(error instanceof LeaseHeldError)) throw error;
		console.error(error.message);
		process.exit(1);
	}
	setInterval(() => {
		lease.heartbeat().catch((error) => {
			// A failed write is not a lost lease: the next heartbeat tries again.
			console.error("The lease heartbeat failed:", error);
		});
	}, LEASE_HEARTBEAT_MS).unref();
	console.log(
		`Holding the database lease: epoch ${lease.epoch}, pid ${lease.pid} on ${lease.host}.`,
	);
	return lease;
}
