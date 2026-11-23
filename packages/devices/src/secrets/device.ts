import { HostUnreachableError } from "@nightshift/engine";
import type { HostClient } from "../contract";
import type { Link } from "../links";

export { PERSONAL_DEADLINE_MS } from "./personal";

/**
 * One call of a Host over its link, for a secret: within `deadlineMs`,
 * else `HostUnreachableError`, as is a Host without a link here. A Host
 * of a version without the call says `olderHost`.
 */
export async function askHost<T>(
	link: Pick<Link, "call"> | undefined,
	onHost: (client: HostClient) => Promise<T>,
	options: { deadlineMs: number; olderHost: string },
): Promise<T> {
	if (!link) throw new HostUnreachableError();
	return link.call(onHost, {
		...options,
		late: () => new HostUnreachableError(),
	});
}
