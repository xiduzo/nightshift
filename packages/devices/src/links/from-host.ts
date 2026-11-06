import { HostUnreachableError, OlderHostError } from "@nightshift/engine";
import { Refusal, type RefusalKind } from "@nightshift/refusal";
import { ORPCError } from "@orpc/client";
import { type HostClient, hostContract, refusalDataSchema } from "../contract";

/**
 * How a Link translates every answer of a Host into this computer's
 * words, so that no caller reads the wire's codes. The Host answers about
 * this computer's Device key, not the person's session here, so its codes
 * never pass on as they are (`fromHost`):
 *
 * - UNAUTHORIZED (the Host does not know the key), or a refusal of kind
 *   `signed-out`: `NotPairedError`, a refusal (`conflict`) that says to
 *   pair this computer again. Never a 401: the screen would send the
 *   person to sign in here.
 * - NOT_FOUND, or any 404: the Host runs an older version of Night Shift
 *   and does not know the procedure. `OlderHostError`, with the words the
 *   caller gives for its procedure, else its one sentence. This is the
 *   one test of a Host's version: a refusal of this version's Host comes
 *   as BAD_REQUEST with its kind, never as NOT_FOUND.
 * - HOST_UNREACHABLE: `HostUnreachableError`, the same here.
 * - BAD_REQUEST, FORBIDDEN, CONFLICT: a `Refusal` with the Host's words. A
 *   BAD_REQUEST carries its kind (`refusalDataSchema`) from a Host of this
 *   version. An older Host's is `invalid`.
 * - Any other error of the Host is a failure: an `Error` with the Host's
 *   error as its cause, so the person sees plain words and the details go
 *   to the log.
 * - An error that is not the Host's (the network, this computer) passes
 *   on as it is.
 *
 * `translated` gives a Host's procedures with every answer so, and
 * `hostCall` one call on them within a deadline: `Link.call` and its fake
 * in memory are both made of them.
 */

/**
 * Why a call to a Host fails when the Host no longer knows this
 * computer's Device key: its access there was removed. The person pairs
 * it again, from "Join a Host" in Settings.
 */
export const NOT_PAIRED =
	"This computer is no longer paired with the Host of this Space. Choose Join a Host in Settings to pair it again.";

/** How long a call on the Host may take by default before it settles. */
export const CALL_DEADLINE_MS = 2 * 60_000;

/** What a person reads for a call on the Host that did not settle in time. */
export const HOST_TOO_SLOW =
	"The computer that keeps this Space did not answer in time. Try again in a moment.";

/** The Host no longer knows this computer's Device key: a refusal that says to pair this computer again. */
export class NotPairedError extends Refusal {
	constructor(options?: ErrorOptions) {
		super("conflict", NOT_PAIRED, options);
		this.name = "NotPairedError";
	}
}

/** How one call on the Host may end besides its answer. */
export type CallOptions = {
	/**
	 * How long the call may take to settle. Default `CALL_DEADLINE_MS`. A
	 * call that opens a stream settles when the stream opens, so the
	 * stream itself has no limit.
	 */
	deadlineMs?: number;
	/** The error when it does not settle in time. Default: a refusal (`unavailable`) with `HOST_TOO_SLOW`. */
	late?(): Error;
	/** What a person reads when the Host runs a version without the procedure. Default: the one sentence of `OlderHostError`. */
	olderHost?: string;
};

/** The kind of refusal each code of the peer protocol is (`hostContract`). */
const KIND_OF_CODE: Record<string, RefusalKind> = {
	BAD_REQUEST: "invalid",
	FORBIDDEN: "forbidden",
	CONFLICT: "conflict",
};

/** The error a person gets on this computer for `error`, the error of a call this computer made to a Host (see above). */
export function fromHost(error: unknown, olderHost?: string): unknown {
	if (!(error instanceof ORPCError)) return error;
	if (error.code === "HOST_UNREACHABLE") {
		return new HostUnreachableError();
	}
	if (error.code === "NOT_FOUND" || error.status === 404) {
		return new OlderHostError(olderHost, { cause: error });
	}
	const data = refusalDataSchema.safeParse(error.data);
	const kind =
		error.code === "BAD_REQUEST" && data.success
			? data.data.kind
			: KIND_OF_CODE[error.code];
	if (error.code === "UNAUTHORIZED" || kind === "signed-out") {
		return new NotPairedError({ cause: error });
	}
	if (kind) return new Refusal(kind, error.message, { cause: error });
	return new Error(`The Host answered ${error.code}.`, { cause: error });
}

/** One procedure of a Host, as a Device calls it. */
type Procedure = (input: unknown, options?: unknown) => Promise<unknown>;

/**
 * The Host's procedures with every answer in this computer's words
 * (`fromHost`): what a Link hands out. Each procedure is read from
 * `client` at the call, so a Host that changes a procedure later is still
 * called as it is now. A procedure that opens a stream translates the
 * stream's errors too.
 */
export function translated(client: HostClient): HostClient {
	const groups = client as unknown as Record<string, Record<string, Procedure>>;
	return Object.fromEntries(
		Object.entries(hostContract).map(([group, procedures]) => [
			group,
			Object.fromEntries(
				Object.keys(procedures).map((name) => [
					name,
					(input: unknown, options?: unknown) =>
						inWords(() => {
							const procedure = groups[group]?.[name];
							if (!procedure)
								throw new Error(`This Host has no ${group}.${name}.`);
							return procedure(input, options);
						}),
				]),
			),
		]),
	) as unknown as HostClient;
}

/** The answer of `call`, or its error in this computer's words. A stream's errors come so too. */
async function inWords(call: () => Promise<unknown>): Promise<unknown> {
	let value: unknown;
	try {
		value = await call();
	} catch (error) {
		throw fromHost(error);
	}
	return isStream(value) ? streamInWords(value) : value;
}

async function* streamInWords<T>(source: AsyncIterable<T>): AsyncGenerator<T> {
	try {
		yield* source;
	} catch (error) {
		throw fromHost(error);
	}
}

function isStream(value: unknown): value is AsyncIterable<unknown> {
	return (
		typeof value === "object" && value !== null && Symbol.asyncIterator in value
	);
}

/**
 * One call on a Host whose answers are in this computer's words
 * (`translated`), within its deadline (`CallOptions`). The deadline's
 * error wins the race, and only then `signal` aborts: a stream that
 * opened in time runs on. A Host of a version without the procedure says
 * the caller's words for it.
 */
export async function hostCall<T>(
	client: HostClient,
	use: (client: HostClient, signal: AbortSignal) => Promise<T>,
	options: CallOptions = {},
): Promise<T> {
	const late = new AbortController();
	let timer: Timer | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			// The error first: the aborted call then rejects too, but too late to win the race.
			reject(options.late?.() ?? new Refusal("unavailable", HOST_TOO_SLOW));
			late.abort();
		}, options.deadlineMs ?? CALL_DEADLINE_MS);
		timer.unref?.();
	});
	try {
		return await Promise.race([use(client, late.signal), deadline]);
	} catch (error) {
		if (error instanceof OlderHostError && options.olderHost) {
			throw new OlderHostError(options.olderHost, { cause: error });
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
