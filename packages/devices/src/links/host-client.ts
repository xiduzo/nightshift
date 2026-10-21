import type {
	FeedStep,
	OwnDevice,
	RunCommandInput,
	StartRunInput,
	TranscriptEntry,
} from "@nightshift/engine";
import { type Client, createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ArchiveRef } from "../archive";
import type { RunRows, SyncBatch, SyncCursors } from "../exchange";
import type { OfferCaps } from "../offers";
import { pinnedFetch } from "../reach";
import type { WorkDelivery, WorkReply, WorkRequest } from "../work";
import type { HostHello, PairingRedeemed, PairingStart } from "./types";

/** A run start for the Host, without its Person: the Host starts it for the key's Person. */
type HostRunStart = (StartRunInput extends infer T
	? T extends unknown
		? Omit<T, "startedBy">
		: never
	: never) & { spaceId: string; deviceId: string };

/** One procedure of a Host, as a Device calls it. */
type Call<Input, Output> = Client<Record<never, never>, Input, Output, Error>;

/**
 * The procedures of a Host that a Device calls: the peer protocol, as
 * `@nightshift/devices` speaks it. The API's router serves them
 * (`@nightshift/api`); its tests check that the router's client fits
 * this type.
 */
export type HostClient = {
	link: {
		hello: Call<undefined, HostHello>;
		heartbeat: Call<undefined, HostHello>;
	};
	pairing: {
		start: Call<
			{ deviceId: string; name: string; platform: string },
			PairingStart
		>;
		redeem: Call<
			{ deviceCode: string; deviceId: string; home: boolean; address: string },
			PairingRedeemed
		>;
	};
	sync: {
		stream: Call<{ cursors: SyncCursors }, AsyncIterable<SyncBatch>>;
		push: Call<RunRows, { events: number }>;
		command: Call<RunCommandInput & { runId: string; spaceId: string }, void>;
		commandDone: Call<{ id: string; error: string | null }, void>;
		startRun: Call<HostRunStart, { runId: string }>;
		devices: Call<{ spaceId: string; projectId: string }, OwnDevice[]>;
		offer: Call<
			OfferCaps & { spaceId: string; profile: string; deviceName: string },
			void
		>;
		withdrawOffer: Call<{ spaceId: string; profile: string }, void>;
		addClone: Call<
			{ spaceId: string; projectId: string; deviceName: string },
			void
		>;
	};
	archive: {
		put: Call<{ ref: ArchiveRef; content: string }, void>;
		get: Call<{ ref: ArchiveRef }, string | null>;
		follow: Call<
			{ step: FeedStep; afterSeq: number },
			AsyncIterable<TranscriptEntry>
		>;
		tail: Call<
			{ step: FeedStep; entries: TranscriptEntry[]; ended: boolean },
			void
		>;
	};
	devices: {
		work: Call<{ running: string[] }, AsyncIterable<WorkDelivery>>;
		call: Call<
			{ deviceId: string; request: WorkRequest },
			AsyncIterable<WorkReply>
		>;
		reachable: Call<{ deviceId: string }, boolean>;
		workReply: Call<
			{ id: string; replies: WorkReply[]; done: boolean },
			{ known: boolean }
		>;
	};
};

/**
 * The procedures of a Host at one address, as a Device calls them: with its
 * Device key once it has one, trusting only the pinned certificate when it
 * pinned one.
 */
export function hostClient(
	address: string,
	options: { key?: string; certificate?: string | null } = {},
): HostClient {
	const send = pinnedFetch(options.certificate ?? null);
	const link = new RPCLink({
		url: `${address.replace(/\/$/, "")}/rpc`,
		headers: options.key ? { authorization: `Bearer ${options.key}` } : {},
		fetch: (request, init) => send(request, init),
	});
	return createORPCClient(link);
}
