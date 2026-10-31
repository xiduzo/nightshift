/**
 * The words of a lease (ADR 7) that the engine shares with the Devices:
 * a take, its answer, and the Host's part of the work (`LeaseHost`).
 * The Replica that keeps a Space keeps its leases. A run that another
 * Device walks asks that Host through the `Relay`.
 */

/** The run that holds a lease, as a run that waits for it reads it. */
export type LeaseHolder = {
	runId: string;
	/** The run's title when it took the lease. */
	runTitle: string;
	/** The Device that walks the run. */
	walkerId: string;
	/** When the run took it, in epoch ms. */
	since: number;
};

/** A run asks for a lease of its Space. */
export type LeaseTake = {
	spaceId: string;
	/** The rendered name. */
	name: string;
	runId: string;
	runTitle: string;
	/** The Device that walks the run and renews the lease. */
	walkerId: string;
	/** How long the lease holds without a renewal, in ms. */
	ttlMs: number;
};

/**
 * The answer to a take. `held`: the run holds the lease now (it may have
 * held it already). `busy`: another run holds it. `unreachable`: the Host
 * that keeps the Space cannot be reached, so nobody knows yet.
 */
export type LeaseAnswer =
	| { kind: "held" }
	| { kind: "busy"; holder: LeaseHolder }
	| { kind: "unreachable" };

/** One lease of a Space, as its keeper has it. */
export type SpaceLease = LeaseHolder & {
	spaceId: string;
	name: string;
	/** Free after this time, unless its holder renews it. */
	expiresAt: number;
};

/**
 * What the Replica that keeps a Space does with its leases. The engine
 * keeps the leases of the Spaces this Replica keeps (`Engine.leases`), and
 * asks the Host of every other Space through `Relay.leases`. A Host that
 * cannot be reached throws `HostUnreachableError`.
 */
export type LeaseHost = {
	/** Takes the lease for the run, unless another run holds it. */
	take(take: LeaseTake): Promise<Exclude<LeaseAnswer, { kind: "unreachable" }>>;
	/**
	 * Keeps the run's leases of these names for their ttl from now. Returns
	 * the names the run no longer holds: they expired, or a person
	 * released them.
	 */
	renew(input: {
		spaceId: string;
		runId: string;
		names: readonly string[];
		/** Only the leases this Device walks the run for: a Host checks the Device's key. */
		walkerId?: string;
	}): Promise<string[]>;
	/** Lets go of the run's leases of these names, or of all of them. */
	release(input: {
		spaceId: string;
		runId: string;
		names?: readonly string[];
		/** Only the leases this Device walks the run for: a Host checks the Device's key. */
		walkerId?: string;
	}): Promise<void>;
};
