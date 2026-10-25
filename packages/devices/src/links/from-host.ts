import { HostUnreachableError } from "@nightshift/engine";
import { Refusal, type RefusalKind } from "@nightshift/refusal";
import { ORPCError } from "@orpc/client";
import { refusalDataSchema } from "../contract";

/**
 * Why a call to a Host fails when the Host no longer knows this
 * computer's Device key: its access there was removed. The person pairs
 * it again, from "Join a Host" in Settings.
 */
export const NOT_PAIRED =
	"This computer is no longer paired with the Host of this Space. Choose Join a Host in Settings to pair it again.";

/** The kind of refusal each code of the peer protocol is (`hostContract`). */
const KIND_OF_CODE: Record<string, RefusalKind> = {
	BAD_REQUEST: "invalid",
	FORBIDDEN: "forbidden",
	NOT_FOUND: "not-found",
	CONFLICT: "conflict",
};

/**
 * The error a person gets on this computer for the error of a call this
 * computer made to a Host for them (the relay, a Person's phones). The
 * Host answers about this computer's Device key, not the person's session
 * here, so its codes never pass on as they are:
 *
 * - UNAUTHORIZED (the Host does not know the key), or a refusal of kind
 *   `signed-out`: a refusal (`conflict`) that says to pair this computer
 *   again (`NOT_PAIRED`). Never a 401: the screen would send the person
 *   to sign in here.
 * - HOST_UNREACHABLE: `HostUnreachableError`, the same here.
 * - BAD_REQUEST, FORBIDDEN, NOT_FOUND, CONFLICT: a `Refusal` with the
 *   Host's words. A BAD_REQUEST carries its kind (`refusalDataSchema`)
 *   from a Host of this version. An older Host's is `invalid`.
 * - Any other error of the Host is a failure: an `Error` with the Host's
 *   error as its cause, so the person sees plain words and the details go
 *   to the log.
 * - An error that is not the Host's (the network, this computer) passes
 *   on as it is.
 */
export function fromHost(error: unknown): unknown {
	if (!(error instanceof ORPCError)) return error;
	if (error.code === "HOST_UNREACHABLE") {
		return new HostUnreachableError();
	}
	const data = refusalDataSchema.safeParse(error.data);
	const kind =
		error.code === "BAD_REQUEST" && data.success
			? data.data.kind
			: KIND_OF_CODE[error.code];
	if (error.code === "UNAUTHORIZED" || kind === "signed-out") {
		return new Refusal("conflict", NOT_PAIRED, { cause: error });
	}
	if (kind) return new Refusal(kind, error.message, { cause: error });
	return new Error(`The Host answered ${error.code}.`, { cause: error });
}
