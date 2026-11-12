import type { DeviceKeyAccess } from "@nightshift/auth";
import type { TranscriptEntry } from "@nightshift/engine";
import { implement } from "@orpc/server";
import { hostContract, type PhoneView, type WorkRequest } from "../contract";
import type { HostExchange } from "../exchange";
import { readable } from "./keyed-call";
import type { Devices } from "./types";

/**
 * This computer as a Host, as its paired Devices call it: `hostContract`,
 * implemented once. The API mounts this router at the contract's paths
 * (`/rpc/sync/push`), and a test runs the same router in memory
 * (`inMemoryHost`), so a Device's tests cross the code that serves it.
 *
 * The router is a table: one line per procedure, from the contract's
 * name to the call it makes. What every keyed call crosses sits before
 * it, once (`keyed-call.ts`): the admission of the key as a `Caller`,
 * with the permission the procedure's meta names, and every error in the
 * codes older Devices know (`readable`). Pairing needs no key. The
 * contract's input schemas check every input, with their defaults and
 * their transforms. Its output schemas describe a reply and never change
 * it.
 */

/** The phones of a Person on this Host, as the API reads them from their push targets. */
export type HostPhones = {
	list(personId: string): Promise<PhoneView[]>;
	/** Signs one of them out. Refuses (`not-found`) a phone that is not the Person's. */
	remove(personId: string, id: string): Promise<void>;
};

/** What the router needs for one call. The API's context has it; the in-memory Host makes it. */
export type HostPeerContext = {
	/** The Device key the call carries, resolved. Null: none, or a key this Host does not know. */
	deviceKey: DeviceKeyAccess | null;
	/** This computer as the Host of run history. */
	exchange: HostExchange;
	/** This computer as a Host: the admission of a keyed call, pairing, and the answer to a link. */
	devices: Pick<
		Devices,
		| "admit"
		| "startPairing"
		| "redeemPairing"
		| "hello"
		| "revoke"
		| "personalSecrets"
		| "projectSecrets"
		| "secretMoves"
	>;
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

/** The procedures that need a Device key: the call's key, admitted once, as `caller`. */
const keyed = peer.use(async ({ context, procedure, next }) => {
	const caller = await context.devices.admit(
		context.deviceKey,
		procedure["~orpc"].meta.key,
	);
	return next({ context: { caller } });
});

export const hostRouter = os.router({
	link: {
		hello: keyed.link.hello.handler(({ context }) =>
			context.devices.hello(context.caller),
		),
		heartbeat: keyed.link.heartbeat.handler(({ context }) =>
			context.devices.hello(context.caller),
		),
		phones: keyed.link.phones.handler(({ context }) =>
			context.phones.list(context.caller.personId),
		),
		removePhone: keyed.link.removePhone.handler(({ context, input }) =>
			context.phones.remove(context.caller.personId, input.id),
		),
		leave: keyed.link.leave.handler(({ context }) =>
			context.devices.revoke(context.caller.personId, context.caller.deviceId),
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
			context.exchange.pull(context.caller, input),
		),
		// A stream's handler yields: the web client reads that shape to keep a
		// stream out of a batch.
		stream: keyed.sync.stream.handler(async function* ({
			context,
			input,
			signal,
		}) {
			yield* context.exchange.stream(context.caller, input, signal);
		}),
		commands: keyed.sync.commands.handler(async function* ({
			context,
			signal,
		}) {
			yield* context.exchange.commands(context.caller, signal);
		}),
		push: keyed.sync.push.handler(({ context, input }) =>
			context.exchange.push(context.caller, input),
		),
		command: keyed.sync.command.handler(({ context, input }) =>
			context.exchange.command(context.caller, input),
		),
		commandDone: keyed.sync.commandDone.handler(({ context, input }) =>
			context.exchange.commandDone(context.caller, input),
		),
		startRun: keyed.sync.startRun.handler(({ context, input }) =>
			context.exchange.startRun(context.caller, input),
		),
		startTest: keyed.sync.startTest.handler(({ context, input }) =>
			context.exchange.startTest(context.caller, input),
		),
		devices: keyed.sync.devices.handler(({ context, input }) =>
			context.exchange.devices(context.caller, input),
		),
		offer: keyed.sync.offer.handler(({ context, input }) =>
			context.exchange.offer(context.caller, input),
		),
		withdrawOffer: keyed.sync.withdrawOffer.handler(({ context, input }) =>
			context.exchange.withdrawOffer(context.caller, input),
		),
		addProject: keyed.sync.addProject.handler(({ context, input }) =>
			context.exchange.addProject(context.caller, input),
		),
		addWithoutFolder: keyed.sync.addWithoutFolder.handler(
			({ context, input }) =>
				context.exchange.addWithoutFolder(context.caller, input),
		),
		addClone: keyed.sync.addClone.handler(({ context, input }) =>
			context.exchange.addClone(context.caller, input),
		),
		setClones: keyed.sync.setClones.handler(({ context, input }) =>
			context.exchange.setClones(context.caller, input),
		),
		mergePersonal: keyed.sync.mergePersonal.handler(({ context, input }) =>
			context.exchange.mergePersonal(context.caller, input),
		),
	},
	leases: {
		take: keyed.leases.take.handler(({ context, input }) =>
			context.exchange.leaseTake(context.caller, input),
		),
		renew: keyed.leases.renew.handler(({ context, input }) =>
			context.exchange.leaseRenew(context.caller, input),
		),
		release: keyed.leases.release.handler(({ context, input }) =>
			context.exchange.leaseRelease(context.caller, input),
		),
	},
	archive: {
		put: keyed.archive.put.handler(({ context, input }) =>
			context.exchange.archivePut(context.caller, input),
		),
		get: keyed.archive.get.handler(({ context, input }) =>
			context.exchange.archiveGet(context.caller, input),
		),
		knowledgePut: keyed.archive.knowledgePut.handler(({ context, input }) =>
			context.exchange.knowledgePut(context.caller, input),
		),
		knowledgeGet: keyed.archive.knowledgeGet.handler(({ context, input }) =>
			context.exchange.knowledgeGet(context.caller, input),
		),
		follow: keyed.archive.follow.handler(async function* ({
			context,
			input,
			signal,
		}) {
			yield* context.exchange.archiveFollow(context.caller, input, signal);
		}),
		tail: keyed.archive.tail.handler(({ context, input }) =>
			context.exchange.archiveTail(context.caller, {
				...input,
				// The Walker's own events, which the wire describes loosely.
				entries: input.entries as TranscriptEntry[],
			}),
		),
	},
	secrets: {
		list: keyed.secrets.list.handler(({ context }) =>
			context.devices.personalSecrets.list(context.caller),
		),
		values: keyed.secrets.values.handler(({ context, input }) =>
			context.devices.personalSecrets.values(context.caller, input),
		),
		set: keyed.secrets.set.handler(({ context, input }) =>
			context.devices.personalSecrets.set(context.caller, input),
		),
		remove: keyed.secrets.remove.handler(({ context, input }) =>
			context.devices.personalSecrets.remove(context.caller, input),
		),
		moveOnDevice: keyed.secrets.moveOnDevice.handler(({ context, input }) =>
			context.devices.secretMoves.move(context.caller, input),
		),
	},
	spaceSecrets: {
		list: keyed.spaceSecrets.list.handler(({ context, input }) =>
			context.devices.projectSecrets.space.list(context.caller, input),
		),
		set: keyed.spaceSecrets.set.handler(({ context, input }) =>
			context.devices.projectSecrets.space.set(context.caller, input),
		),
		remove: keyed.spaceSecrets.remove.handler(({ context, input }) =>
			context.devices.projectSecrets.space.remove(context.caller, input),
		),
		take: keyed.spaceSecrets.take.handler(({ context, input }) =>
			context.devices.projectSecrets.space.take(context.caller, input),
		),
	},
	projectSecrets: {
		list: keyed.projectSecrets.list.handler(({ context, input }) =>
			context.devices.projectSecrets.list(context.caller, input),
		),
		values: keyed.projectSecrets.values.handler(({ context, input }) =>
			context.devices.projectSecrets.values(context.caller, input),
		),
		set: keyed.projectSecrets.set.handler(({ context, input }) =>
			context.devices.projectSecrets.set(context.caller, input),
		),
		remove: keyed.projectSecrets.remove.handler(({ context, input }) =>
			context.devices.projectSecrets.remove(context.caller, input),
		),
		take: keyed.projectSecrets.take.handler(({ context, input }) =>
			context.devices.projectSecrets.take(context.caller, input),
		),
	},
	devices: {
		work: keyed.devices.work.handler(async function* ({
			context,
			input,
			signal,
		}) {
			yield* context.exchange.work(context.caller, input, signal);
		}),
		call: keyed.devices.call.handler(async function* ({
			context,
			input,
			signal,
		}) {
			yield* context.exchange.call(
				context.caller,
				{
					deviceId: input.deviceId,
					// The call's input as the Device port types it: the placed Device checks it.
					request: input.request as unknown as WorkRequest,
				},
				signal,
			);
		}),
		reachable: keyed.devices.reachable.handler(({ context, input }) =>
			context.exchange.reachable(context.caller, input),
		),
		workReply: keyed.devices.workReply.handler(({ context, input }) =>
			context.exchange.workReply(context.caller, input),
		),
	},
});
