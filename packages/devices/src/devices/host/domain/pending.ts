/**
 * Pairings in progress on this Host: a joining Device asked for a code,
 * and a Person has not yet let it in, or the code has not expired.
 * In memory: a pairing outlives no Host restart. A `bun --hot` reload
 * hands the map to the next Host, so a Device that asked for a code
 * before it still joins under its own name.
 */

/** A joining Device, as it introduced itself when it asked for a code. */
export type Pending = {
	deviceId: string;
	name: string;
	platform: string;
	/** It asks this Host to be its home Host. */
	home: boolean;
	/** The fingerprint of its computer (ADR 20). Undefined: it did not say. */
	machine?: string;
	userCode: string;
	expiresAt: number;
};

/** The pairings in progress, by device code. */
export type PendingPairings = Map<string, Pending>;

/** "abcd-efgh" and "ABCDEFGH" are one code. */
export function normalizeUserCode(userCode: string): string {
	return userCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/** Drops codes whose time has passed. */
export function prunePending(pending: PendingPairings, now: number): void {
	for (const [code, item] of pending) {
		if (item.expiresAt < now) pending.delete(code);
	}
}

/** The pairing that shows this user code, if one is still open. */
export function pendingByUserCode(
	pending: PendingPairings,
	userCode: string,
): Pending | undefined {
	const code = normalizeUserCode(userCode);
	for (const item of pending.values()) if (item.userCode === code) return item;
	return undefined;
}

/** An empty map of pairings in progress. */
export function createPendingPairings(
	pending?: PendingPairings,
): PendingPairings {
	return pending ?? new Map();
}
