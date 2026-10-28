import type { DeviceKeyAccess } from "@nightshift/auth";
import { HostUnreachableError, type TranscriptEntry } from "@nightshift/engine";
import { FAILURE_MESSAGE, Refusal } from "@nightshift/refusal";
import { implement, ORPCError } from "@orpc/server";
import { hostContract, type PhoneView, type WorkRequest } from "../contract";
import type { HostExchange } from "../exchange";
import type { Devices } from "./types";

/**
 * This computer as a Host, as its paired Devices call it: `hostContract`,
 * implemented once. The API mounts this router at the contract's paths
 * (`/rpc/sync/push`), and a test runs the same router in memory
 * (`inMemoryHost`), so a Device's tests cross the code that serves it.
 *
 * - The key: a procedure whose meta names a permission needs a Device key
 *   that allows it. None is UNAUTHORIZED, one without it is FORBIDDEN.
 *   Pairing needs none.
 * - Errors: an ORPCError passes on as it is. A `HostUnreachableError` is
 *   a HOST_UNREACHABLE (503), and any other `Refusal` a BAD_REQUEST with
 *   its words: an older Device reads every refusal so, and a FORBIDDEN
 *   would tell it that its key is no good. Any other error is a failure:
 *   an INTERNAL_SERVER_ERROR with plain words, and the details go to the
 *   Host's log. An error inside a stream passes on as it is.
 * - Values: the contract's input schemas check every input, with their
 *   defaults and their transforms. Its output schemas describe a reply and
 *   never change it.
 */

/** The phones of a Person on this Host, as the API reads them from their push targets. */
export type HostPhones = {
	list(personId: string): Promise<PhoneView[]>;
	/** Signs one of them out. Refuses (NOT_FOUND) a phone that is not the Person's. */
	remove(personId: string, id: string): Promise<void>;
};

/** What the router needs for one call. The API's context has it; the in-memory Host makes it. */
export type HostPeerContext = {
	/** The Device key the call carries, resolved. Null: none, or a key this Host does not know. */
	deviceKey: DeviceKeyAccess | null;
	/** This computer as the Host of run history. */
	exchange: HostExchange;
	/** This computer as a Host: pairing, and the answer to a link. */
	devices: Pick<Devices, "startPairing" | "redeemPairing" | "hello" | "revoke">;
	phones: HostPhones;
};

const os = implement(hostContract).$context<HostPeerContext>();

/** The procedures that pass a refusal on to the Device, and keep the details of a failure here. */
const peer = os.use(async ({ next, path }) => {
	try {
		return await next();
	} catch (error) {
		throw readable(error, path);
	}
});

/** The procedures that need a Device key: the key the procedure's meta asks for, as `key`. */
const keyed = peer.use(async ({ context, procedure, next }) => {
	const key = context.deviceKey;
	if (!key) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "This device has no access here. Pair it again.",
		});
	}
	const need = procedure["~orpc"].meta.key;
	if (!need || !key.permissions[need]?.length) {
		throw new ORPCError("FORBIDDEN", {
			message: "This device may not do this here.",
		});
	}
	return next({ context: { key } });
});

export const hostRouter = os.router({
	link: {
		hello: keyed.link.hello.handler(({ context }) =>
			context.devices.hello(context.key),
		),
		heartbeat: keyed.link.heartbeat.handler(({ context }) =>
			context.devices.hello(context.key),
		),
		phones: keyed.link.phones.handler(({ context }) =>
			context.phones.list(context.key.personId),
		),
		removePhone: keyed.link.removePhone.handler(({ context, input }) =>
			context.phones.remove(context.key.personId, input.id),
		),
		leave: keyed.link.leave.handler(({ context }) =>
			context.devices.revoke(context.key.personId, context.key.deviceId),
		),
	},
	pairing: {
		start: peer.pairing.start.handler(({ context, input }) =>
			context.devices.startPairing(input),
		),
		redeem: peer.pairing.redeem.handler(({ context, input }) =>
			context.devices.redeemPairing(input),
		),
	},
	sync: {
		pull: keyed.sync.pull.handler(({ context, input }) =>
			context.exchange.pull(context.key, input.cursors),
		),
		stream: keyed.sync.stream.handler(async function* ({
			context,
			input,
			signal,
		}) {
			yield* context.exchange.stream(context.key, input, signal);
		}),
		commands: keyed.sync.commands.handler(async function* ({
			context,
			signal,
		}) {
			yield* context.exchange.commands(context.key, signal);
		}),
		push: keyed.sync.push.handler(({ context, input }) =>
			context.exchange.push(context.key, input),
		),
		command: keyed.sync.command.handler(({ context, input }) =>
			context.exchange.command(context.key, input),
		),
		commandDone: keyed.sync.commandDone.handler(({ context, input }) =>
			context.exchange.commandDone(context.key, input),
		),
		startRun: keyed.sync.startRun.handler(({ context, input }) =>
			context.exchange.startRun(context.key, input),
		),
		devices: keyed.sync.devices.handler(({ context, input }) =>
			context.exchange.devices(context.key, input),
		),
		offer: keyed.sync.offer.handler(({ context, input }) =>
			context.exchange.offer(context.key, input),
		),
		withdrawOffer: keyed.sync.withdrawOffer.handler(({ context, input }) =>
			context.exchange.withdrawOffer(context.key, input),
		),
		addClone: keyed.sync.addClone.handler(({ context, input }) =>
			context.exchange.addClone(context.key, input),
		),
		mergePersonal: keyed.sync.mergePersonal.handler(({ context, input }) =>
			context.exchange.mergePersonal(context.key, input),
		),
	},
	archive: {
		put: keyed.archive.put.handler(({ context, input }) =>
			context.exchange.archivePut(
				context.key,
				input.ref,
				input.content,
				input.stamp,
			),
		),
		get: keyed.archive.get.handler(({ context, input }) =>
			context.exchange.archiveGet(context.key, input.ref),
		),
		follow: keyed.archive.follow.handler(async function* ({
			context,
			input,
			signal,
		}) {
			yield* context.exchange.archiveFollow(context.key, input, signal);
		}),
		tail: keyed.archive.tail.handler(({ context, input }) =>
			context.exchange.archiveTail(context.key, {
				...input,
				// The Walker's own events, which the wire describes loosely.
				entries: input.entries as TranscriptEntry[],
			}),
		),
	},
	devices: {
		work: keyed.devices.work.handler(async function* ({
			context,
			input,
			signal,
		}) {
			yield* context.exchange.work(context.key, input, signal);
		}),
		call: keyed.devices.call.handler(async function* ({
			context,
			input,
			signal,
		}) {
			yield* context.exchange.call(
				context.key,
				{
					deviceId: input.deviceId,
					// The call's input as the Device port types it: the placed Device checks it.
					request: input.request as unknown as WorkRequest,
				},
				signal,
			);
		}),
		reachable: keyed.devices.reachable.handler(({ context, input }) =>
			context.exchange.reachable(context.key, input.deviceId),
		),
		workReply: keyed.devices.workReply.handler(({ context, input }) =>
			context.exchange.workReply(context.key, input),
		),
	},
});

/**
 * The error a Device gets for `error`, thrown by the procedure at `path`,
 * in the codes older Devices know (see the router's comment).
 */
function readable(error: unknown, path: readonly string[]): unknown {
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
