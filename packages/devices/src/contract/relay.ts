import type {
	CopyStamp,
	FeedStep,
	OwnDevice,
	Relay,
	TranscriptEntry,
} from "@nightshift/engine";
import type { ArchiveRef } from "./archive";
import type { OfferCaps } from "./offers";

/**
 * What this Device asks of the Hosts it links to: the engine's `Relay` (the
 * actions on rows another Device owns), and what the peers ask beside it:
 * the archive, the live transcripts, the Offers and the Devices a Host
 * knows. `createRelay` carries each over the Links.
 */
export type HostRelay = Relay & {
	/** A file of the archive from the Host that keeps the Space. Null when it has none. */
	archive(ref: ArchiveRef): Promise<string | null>;
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
	 * Keeps a file of a run this computer walks in the archive of the Host
	 * that keeps the Space, with its stamp for a step's file.
	 */
	archivePut(
		ref: ArchiveRef,
		content: string,
		stamp?: CopyStamp,
	): Promise<void>;
	/**
	 * The actor's Devices, as the Host that keeps the Space knows them:
	 * whether each is online and has a Clone of the project.
	 */
	devices(input: { spaceId: string; projectId: string }): Promise<OwnDevice[]>;
};
