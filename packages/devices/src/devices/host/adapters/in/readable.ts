import { HostUnreachableError } from "@nightshift/engine";
import { FAILURE_MESSAGE, Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/server";

/**
 * The error a Device gets for `error`, thrown by the procedure at `path`,
 * in the codes of the contract:
 * - An ORPCError passes on as it is.
 * - A HostUnreachableError is HOST_UNREACHABLE (503).
 * - Any other Refusal is a BAD_REQUEST with its words and its kind
 *   beside them, a not-found included. An UNAUTHORIZED only ever means the
 *   key. A FORBIDDEN means a permission of the key, or a role that does not
 *   allow the call. A NOT_FOUND means a Host too old to serve the procedure.
 * - Any other error is a failure: INTERNAL_SERVER_ERROR with plain
 *   words, and the details go to the Host's log.
 *
 * A RoleRefusal never reaches this: the Host router maps it to FORBIDDEN
 * first.
 */
export function readable(
	error: unknown,
	path: readonly string[],
): ORPCError<string, unknown> {
	if (error instanceof ORPCError) return error;
	if (error instanceof HostUnreachableError) {
		return new ORPCError("HOST_UNREACHABLE", {
			status: 503,
			message: error.message,
			cause: error,
		});
	}
	if (error instanceof Refusal) {
		return new ORPCError("BAD_REQUEST", {
			message: error.message,
			data: { kind: error.kind },
			cause: error,
		});
	}
	console.error(`[host] ${path.join(".")} failed:`, error);
	return new ORPCError("INTERNAL_SERVER_ERROR", {
		message: FAILURE_MESSAGE,
		cause: error,
	});
}
