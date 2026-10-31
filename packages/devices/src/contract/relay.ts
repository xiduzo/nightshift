import type {
	ArchiveHost,
	FeedStep,
	OwnDevice,
	Relay,
	TranscriptEntry,
} from "@nightshift/engine";
import type { OfferCaps } from "./offers";

/** Whether a Replica's documents and its Host's are in step (`HostRelay.inStep`). */
export type InStep = "in step" | "timed out" | "unreachable";

/**
 * What this Device asks of the Hosts it links to: the engine's `Relay` (the
 * actions on rows another Device owns), the Space archive's Hosts
 * (`ArchiveHost`: run walk files and knowledge content), and what the
 * peers ask beside them: the live transcripts, the Offers and the Devices
 * a Host knows. `createRelay` carries each over the Links.
 */
export type HostRelay = Relay &
	ArchiveHost & {
		/**
		 * A step's live transcript from the Host that keeps the Space: its
		 * entries after `afterSeq`, then each new one, until the step ends.
		 * Throws when that Host cannot be reached.
		 */
		follow?(
			step: FeedStep,
			afterSeq: number,
			signal: AbortSignal,
		): AsyncIterable<TranscriptEntry>;
		/** Publishes this Device's Offer in a Space a Host keeps, through that Host. */
		offer(
			input: OfferCaps & {
				spaceId: string;
				/** The profile's id. */
				profile: string;
				profileName: string;
				deviceName: string;
			},
		): Promise<void>;
		/** Withdraws this Device's Offer from a Space a Host keeps, through that Host. */
		withdrawOffer(input: { spaceId: string; profile: string }): Promise<void>;
		/**
		 * Waits until this Replica's copies of these documents of the Space
		 * are in step with its Host's (`Link.inStep`). `in step` at once for a
		 * Space this Replica keeps; `unreachable`, without a wait, while that
		 * Host cannot be reached; `timed out` when they are not in step after
		 * `timeoutMs` (default 10 s).
		 */
		inStep(
			spaceId: string,
			names: readonly string[],
			options?: { timeoutMs?: number; signal?: AbortSignal },
		): Promise<InStep>;
		/**
		 * The actor's Devices, as the Host that keeps the Space knows them:
		 * whether each is online and has a Clone of the project.
		 */
		devices(input: {
			spaceId: string;
			projectId: string;
		}): Promise<OwnDevice[]>;
	};
