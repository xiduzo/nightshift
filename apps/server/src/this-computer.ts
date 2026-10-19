import type { Context } from "hono";

/** What Bun passes as the second argument of `fetch`: its server. */
type BunServer = {
	requestIP?(request: Request): { address: string } | null;
};

/**
 * A request from this computer: from a loopback address, and from no page
 * or one of Night Shift's own (`trustedOrigins`). Only these get the local
 * session. A page of another site that calls the daemon from a browser on
 * this computer does not, and neither does any other computer. The
 * procedures and the sync socket both ask this.
 */
export function isThisComputer(
	address: string | null | undefined,
	origin: string | null | undefined,
	trustedOrigins: ReadonlySet<string>,
): boolean {
	const loopback =
		address === "::1" ||
		address?.startsWith("127.") === true ||
		address?.startsWith("::ffff:127.") === true;
	return loopback && (origin == null || trustedOrigins.has(origin));
}

/** `isThisComputer` for a Hono request served by Bun. */
export function fromThisComputer(
	context: Context,
	trustedOrigins: ReadonlySet<string>,
): boolean {
	const server = context.env as BunServer | undefined;
	return isThisComputer(
		server?.requestIP?.(context.req.raw)?.address,
		context.req.header("origin"),
		trustedOrigins,
	);
}
