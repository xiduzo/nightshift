import type { Context } from "hono";

/** What Bun passes as the second argument of `fetch`: its server. */
type BunServer = {
	requestIP?(request: Request): { address: string } | null;
};

/**
 * A request from this computer: from a loopback address, and from no page
 * or one of Night Shift's own (`trustedOrigins`). Only these get the local
 * session. A page of another site that calls the daemon from a browser on
 * this computer does not, and neither does any other computer.
 */
export function fromThisComputer(
	context: Context,
	trustedOrigins: ReadonlySet<string>,
): boolean {
	const server = context.env as BunServer | undefined;
	const address = server?.requestIP?.(context.req.raw)?.address;
	const loopback =
		address === "::1" ||
		address?.startsWith("127.") === true ||
		address?.startsWith("::ffff:127.") === true;
	const origin = context.req.header("origin");
	return loopback && (origin === undefined || trustedOrigins.has(origin));
}
