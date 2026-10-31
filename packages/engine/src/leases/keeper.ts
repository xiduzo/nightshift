import type { Database } from "@nightshift/db";
import { DEFAULT_LEASE_TTL_MINUTES } from "@nightshift/flows";
import {
	HostUnreachableError,
	type LeaseAnswer,
	type LeaseHost,
} from "../contract";
import { spaceOfRun } from "../log";
import type { LeaseStore } from "./store";

/** How often the Walker renews the leases of its runs, in minutes. A lease's ttl is at least 2. */
const RENEW_EVERY_MINUTES = 1;

/** The run that asks, as the keeper reads it. */
export type LeaseRun = { id: string; spaceId: string; title: string };

/**
 * The leases of the runs this computer walks (ADR 7), wherever their Space
 * keeps them: in this Replica's store for a Space it keeps, else at the
 * Space's Host through the relay (`LeaseHost`). The keeper also remembers
 * which leases each run holds, and renews them while the run lives.
 *
 * - A Host that cannot be reached answers `unreachable` to a take: the
 *   run waits for it. A renewal or a release that cannot reach it is
 *   skipped: the Host lets the lease expire after its ttl.
 * - When a lease of this Replica's store goes, `onFreed` hears it, so the
 *   runs here that wait for a lease try again at once.
 */
export function createLeaseKeeper(deps: {
	db: Database;
	store: LeaseStore;
	/** Whether a Host keeps the Space, not this Replica. */
	hostedElsewhere(spaceId: string): Promise<boolean>;
	/** The leases of the Spaces a Host keeps (`Relay.leases`). */
	relay?: LeaseHost;
	/** This computer's Device: the Walker that renews its runs' leases. */
	walkerId(): Promise<string>;
	minuteMs: number;
	/** A lease of this Replica's store went: the runs that wait for one try again. */
	onFreed?(): void;
	/** A renewal found that the run no longer holds these leases. */
	onLost?(runId: string, names: readonly string[]): void | Promise<void>;
}) {
	const { store } = deps;
	/** The leases each run holds, as far as this computer knows: what it renews. */
	const holding = new Map<string, { spaceId: string; names: Set<string> }>();

	/** Where the Space keeps its leases: here, its Host, or nowhere this computer reaches. */
	async function keeperOf(spaceId: string): Promise<{
		host: LeaseHost | null;
		here: boolean;
	}> {
		if (!(await deps.hostedElsewhere(spaceId))) {
			return { host: store, here: true };
		}
		return { host: deps.relay ?? null, here: false };
	}

	/** Runs `call` at the Space's keeper. Null when no Host can be reached. */
	async function atKeeper<T>(
		spaceId: string,
		call: (host: LeaseHost) => Promise<T>,
	): Promise<{ value: T; here: boolean } | null> {
		const { host, here } = await keeperOf(spaceId);
		if (!host) return null;
		try {
			return { value: await call(host), here };
		} catch (error) {
			if (error instanceof HostUnreachableError) return null;
			throw error;
		}
	}

	function remember(runId: string, spaceId: string, names: string[]): void {
		const known = holding.get(runId);
		if (known) for (const name of names) known.names.add(name);
		else holding.set(runId, { spaceId, names: new Set(names) });
	}

	function forget(runId: string, names?: readonly string[]): void {
		const known = holding.get(runId);
		if (!known) return;
		if (names === undefined) {
			holding.delete(runId);
			return;
		}
		for (const name of names) known.names.delete(name);
		if (known.names.size === 0) holding.delete(runId);
	}

	async function release(
		runId: string,
		names?: readonly string[],
	): Promise<void> {
		const spaceId =
			holding.get(runId)?.spaceId ?? (await spaceOfRun(deps.db, runId));
		forget(runId, names);
		if (spaceId === null) return;
		const released = await atKeeper(spaceId, (host) =>
			host.release({ spaceId, runId, ...(names ? { names } : {}) }),
		);
		if (released?.here) deps.onFreed?.();
	}

	/** Renews every lease this computer's runs hold. A run that lost one hears of it. */
	async function renewAll(): Promise<void> {
		for (const [runId, { spaceId, names }] of [...holding]) {
			try {
				const renewed = await atKeeper(spaceId, (host) =>
					host.renew({ spaceId, runId, names: [...names] }),
				);
				const lost = renewed?.value ?? [];
				if (lost.length === 0) continue;
				forget(runId, lost);
				await deps.onLost?.(runId, lost);
			} catch (error) {
				console.warn(
					`[engine] could not renew the leases of run ${runId}`,
					error,
				);
			}
		}
	}

	return {
		/**
		 * Takes the lease for the run, for `ttlMinutes` (default 30) at a
		 * time. `held` also when the run holds it already.
		 */
		async take(
			run: LeaseRun,
			input: { name: string; ttlMinutes?: number },
		): Promise<LeaseAnswer> {
			const ttlMinutes = input.ttlMinutes ?? DEFAULT_LEASE_TTL_MINUTES;
			const answer = await atKeeper(run.spaceId, async (host) =>
				host.take({
					spaceId: run.spaceId,
					name: input.name,
					runId: run.id,
					runTitle: run.title,
					walkerId: await deps.walkerId(),
					ttlMs: ttlMinutes * deps.minuteMs,
				}),
			);
			if (!answer) return { kind: "unreachable" };
			if (answer.value.kind === "held") {
				remember(run.id, run.spaceId, [input.name]);
			}
			return answer.value;
		},

		/** Lets go of the run's leases of these names, or of all of them. */
		release,

		/**
		 * Remembers leases the run held before this computer started: its
		 * log says so. They are renewed from now on.
		 */
		track(runId: string, spaceId: string, names: readonly string[]): void {
			if (names.length > 0) remember(runId, spaceId, [...names]);
		},

		renewAll,

		/**
		 * Renews the leases every minute until `signal` aborts. The ttl of a
		 * lease is longer than that, so a living run never loses one.
		 */
		start(signal: AbortSignal): void {
			const timer = setInterval(
				() => void renewAll(),
				RENEW_EVERY_MINUTES * deps.minuteMs,
			);
			timer.unref?.();
			signal.addEventListener("abort", () => clearInterval(timer), {
				once: true,
			});
		},
	};
}

export type LeaseKeeper = ReturnType<typeof createLeaseKeeper>;
