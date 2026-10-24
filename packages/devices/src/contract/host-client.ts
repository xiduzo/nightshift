import type {
	CopyStamp,
	FeedStep,
	OwnDevice,
	RunCommandInput,
	StartRunInput,
	TranscriptEntry,
} from "@nightshift/engine";
import type { Client } from "@orpc/client";
import type { ArchiveRef } from "./archive";
import type {
	HostHello,
	PairingRedeemed,
	PairingStart,
	PhoneView,
} from "./links";
import type { OfferCaps } from "./offers";
import type { RunRows, SyncCursors } from "./rows";
import type { SyncBatch } from "./sync";
import type { WorkDelivery, WorkReply, WorkRequest } from "./work";

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
		/** The phones of the key's Person on the Host. */
		phones: Call<undefined, PhoneView[]>;
		/** Signs out one of them. */
		removePhone: Call<{ id: string }, void>;
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
		put: Call<{ ref: ArchiveRef; content: string; stamp?: CopyStamp }, void>;
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
