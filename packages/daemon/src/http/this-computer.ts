import type { Context } from "hono";

/** What Bun passes as the second argument of `fetch`: its server. */
type BunServer = {
	requestIP?(request: Request): { address: string } | null;
};

/**
 * Headers a proxy or a tunnel adds (Caddy, Traefik, Tailscale Serve and
 * Funnel, Cloudflare Tunnel, frp). A request that carries one came from
 * another computer through a program on this one: its loopback address
 * says nothing about who sent it.
 */
const FORWARDED = [
	"forwarded",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-real-ip",
	"cf-connecting-ip",
	"tailscale-user-login",
];

/**
 * A request from this computer: from a loopback address, to a loopback
 * name (`localhost`, `127.0.0.1`, `[::1]`), through no proxy, and from no
 * page or one of Night Shift's own (`trustedOrigins`). Only these get the
 * local session. A page of another site that calls the daemon from a
 * browser on this computer does not, and neither does any other computer:
 * not directly, and not through a proxy or a tunnel on this computer, which
 * connects from the loopback (by a header it adds, or by the Host's public
 * name in the URL when it passes the bytes on as they are). The procedures
 * and the sync socket both ask this.
 */
export function isThisComputer(
	address: string | null | undefined,
	request: { url: string; headers: Headers },
	trustedOrigins: ReadonlySet<string>,
): boolean {
	const loopback =
		address === "::1" ||
		address?.startsWith("127.") === true ||
		address?.startsWith("::ffff:127.") === true;
	if (!loopback) return false;
	if (FORWARDED.some((name) => request.headers.has(name))) return false;
	if (!isLoopbackName(request.url)) return false;
	const origin = request.headers.get("origin");
	return origin == null || trustedOrigins.has(origin);
}

function isLoopbackName(url: string): boolean {
	try {
		const { hostname } = new URL(url);
		return (
			hostname === "localhost" ||
			hostname === "[::1]" ||
			/^127\.\d+\.\d+\.\d+$/.test(hostname)
		);
	} catch {
		return false;
	}
}

/** `isThisComputer` for a Hono request served by Bun. */
export function fromThisComputer(
	context: Context,
	trustedOrigins: ReadonlySet<string>,
): boolean {
	return isThisComputer(peerAddress(context), context.req.raw, trustedOrigins);
}

/** The address of the computer at the other end of the connection, as Bun saw it. */
export function peerAddress(context: Context): string | null {
	const server = context.env as BunServer | undefined;
	return server?.requestIP?.(context.req.raw)?.address ?? null;
}
