import type { HostClient } from "../../../contract";

/**
 * The driven port of the calls: a port of its own, with a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`.
 */

/**
 * The Hosts this computer calls for secrets, over its links, with this
 * Device's key. Nothing it gets is kept here: a value lives in memory for
 * the use that asked.
 */
export type HostCalls = {
	/** This computer's home Host and the Person it knows this Device's owner as. Null without one. */
	home(): Promise<{ hostId: string; personId: string } | null>;
	/**
	 * One call of a Host over its link, within `deadlineMs`. A Host without
	 * a link here, or one that does not answer in time, throws
	 * `HostUnreachableError`: a step then reads the secret as missing.
	 */
	ask<T>(
		hostId: string,
		onHost: (client: HostClient) => Promise<T>,
		options: { deadlineMs: number },
	): Promise<T>;
};
