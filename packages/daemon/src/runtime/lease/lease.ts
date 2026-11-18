import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Database } from "@nightshift/db";
import { daemonLease } from "@nightshift/db/schema";
import { asDate, instant, iso, now as timeNow } from "@nightshift/time";
import { and, eq } from "drizzle-orm";

/**
 * The single-writer lease on the database. One daemon holds it; a second
 * daemon on the same database refuses to start. The holder heartbeats; a
 * holder that stops heartbeating (it died, or its machine slept) loses the
 * lease to the next daemon that starts, after the stale window. `epoch` grows
 * by one on every acquisition: the old holder's next heartbeat matches no row,
 * and it fences itself.
 */

export const LEASE_HEARTBEAT_MS = 10_000;
export const LEASE_STALE_AFTER_MS = 90_000;

/** The one row of `daemon_lease`. */
const LEASE_ROW = 1;

export type LeaseHolder = {
	host: string;
	pid: number;
	epoch: number;
	/** When this holder acquired the lease. */
	since: Date;
};

export type Lease = LeaseHolder & {
	owner: string;
	/** Aborted when the lease is lost or released. The reason says why. */
	signal: AbortSignal;
	/** Proves the lease is still ours. False, and `signal` aborts, when it is lost. */
	heartbeat(): Promise<boolean>;
	/** Gives the lease up, so the next daemon starts at once. */
	release(): Promise<void>;
};

export class LeaseHeldError extends Error {
	constructor(readonly holder: LeaseHolder & { heartbeatAt: Date }) {
		super(
			[
				`Another daemon holds this database: pid ${holder.pid} on ${holder.host}, since ${iso(instant(holder.since))} (last heartbeat ${iso(instant(holder.heartbeatAt))}).`,
				"Two daemons must never share a database. Stop that daemon, or give this one its own NIGHTSHIFT_DATA_DIR (see docs/PLAN.md, section 6).",
			].join("\n"),
		);
		this.name = "LeaseHeldError";
	}
}

/** Whether a process with this pid runs on this machine. */
export function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: it runs, under another user.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

export async function acquireLease(options: {
	db: Database;
	now?: () => number;
	staleAfterMs?: number;
	isAlive?: (pid: number) => boolean;
	host?: string;
	pid?: number;
	/** Called once when the lease is lost, with the reason. */
	onLost?: (reason: string) => void;
}): Promise<Lease> {
	const { db } = options;
	const now = options.now ?? timeNow;
	const staleAfterMs = options.staleAfterMs ?? LEASE_STALE_AFTER_MS;
	const isAlive = options.isAlive ?? pidAlive;
	const host = options.host ?? hostname();
	const pid = options.pid ?? process.pid;
	const owner = randomUUID();

	type Row = typeof daemonLease.$inferSelect;
	const free = (row: Row): boolean =>
		row.owner === null ||
		now() - instant(row.heartbeatAt) > staleAfterMs ||
		(row.host === host && !isAlive(row.pid));

	// A lost race means another daemon just took the lease: read it again,
	// and refuse with its name.
	let won: Row | undefined;
	for (let attempt = 0; attempt < 3 && !won; attempt++) {
		const [row] = await db
			.select()
			.from(daemonLease)
			.where(eq(daemonLease.id, LEASE_ROW));
		if (row && !free(row)) {
			throw new LeaseHeldError({
				host: row.host,
				pid: row.pid,
				epoch: row.epoch,
				since: row.acquiredAt,
				heartbeatAt: row.heartbeatAt,
			});
		}
		const at = asDate(now());
		const taken = {
			owner,
			host,
			pid,
			epoch: (row?.epoch ?? 0) + 1,
			acquiredAt: at,
			heartbeatAt: at,
		};
		[won] = row
			? await db
					.update(daemonLease)
					.set(taken)
					.where(
						and(
							eq(daemonLease.id, LEASE_ROW),
							eq(daemonLease.epoch, row.epoch),
						),
					)
					.returning()
			: await db
					.insert(daemonLease)
					.values({ id: LEASE_ROW, ...taken })
					.onConflictDoNothing()
					.returning();
	}
	if (!won) throw new Error("Could not acquire the database lease.");

	const { epoch } = won;
	const controller = new AbortController();
	const ours = and(
		eq(daemonLease.id, LEASE_ROW),
		eq(daemonLease.owner, owner),
		eq(daemonLease.epoch, epoch),
	);
	const lose = (reason: string) => {
		if (controller.signal.aborted) return;
		controller.abort(new Error(reason));
		options.onLost?.(reason);
	};

	return {
		owner,
		host,
		pid,
		epoch,
		since: won.acquiredAt,
		signal: controller.signal,
		async heartbeat() {
			if (controller.signal.aborted) return false;
			// No check on the last heartbeat's age: a daemon whose machine slept
			// keeps the lease as long as no other daemon took it.
			const updated = await db
				.update(daemonLease)
				.set({ heartbeatAt: asDate(now()) })
				.where(ours)
				.returning({ epoch: daemonLease.epoch });
			if (updated.length > 0) return true;
			const [row] = await db
				.select()
				.from(daemonLease)
				.where(eq(daemonLease.id, LEASE_ROW));
			lose(
				row?.owner
					? `epoch ${epoch} lost to pid ${row.pid} on ${row.host} (epoch ${row.epoch}).`
					: `epoch ${epoch} lost: the lease was released.`,
			);
			return false;
		},
		async release() {
			if (controller.signal.aborted) return;
			controller.abort(new Error("released"));
			await db.update(daemonLease).set({ owner: null }).where(ours);
		},
	};
}
