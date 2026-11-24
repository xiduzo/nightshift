import { Refusal } from "@nightshift/refusal";
import { SELF_PAIR, twinOnlineWords } from "./words";

/**
 * A computer cannot pair with itself: the joining Device id is this
 * Host's own.
 */
export function refuseSelfPair(selfId: string, deviceId: string): void {
	if (deviceId === selfId) throw new Refusal("invalid", SELF_PAIR);
}

/**
 * One computer is one Device (ADR 20): a home Device of the same owner on
 * the same computer gets that Device back, unless its Night Shift is
 * still linked.
 */
export type Twin = { id: string; name: string; online: boolean } | null;

/** The fingerprint to match, only when this Host is to be the home Host. */
export function twinMachine(
	home: boolean,
	machine: string | undefined,
): string | undefined {
	return home ? machine : undefined;
}

/**
 * The row to join as: the twin when it is not this Host, else the
 * Device that asked. Null twin: the Device that asked.
 */
export function adoptedTwin<T extends { id: string }>(
	twin: T | null,
	selfId: string,
): T | null {
	return twin && twin.id !== selfId ? twin : null;
}

/** Refuses while the twin's Night Shift is still linked to this Host. */
export function refuseOnlineTwin(twin: Twin, hostName: string): void {
	if (!twin?.online) return;
	throw new Refusal("conflict", twinOnlineWords(hostName, twin.name));
}
