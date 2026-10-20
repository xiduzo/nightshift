import type { TranscriptEntry } from "../log";
import type {
	ArchiveRef,
	FeedStep,
	OfferCaps,
	OwnDevice,
	RunCommandInput,
} from "../peers";
import type { StartRunInput } from "./engine";

/**
 * What the engine asks of the Hosts this Device links to: the actions on
 * rows another Device owns. The daemon gives it; without it, a run walked
 * elsewhere is read-only.
 */
export type Relay = {
	/**
	 * Hands a person's action on a run walked elsewhere to its Walker,
	 * through the Host. Throws when no Host takes it.
	 */
	command(
		command: RunCommandInput & {
			spaceId: string;
			runId: string;
			walkerId: string;
			personId: string;
		},
	): Promise<void>;
	/** Records this Device's Clone in a Space a Host keeps, through that Host. */
	addClone(input: {
		spaceId: string;
		projectId: string;
		deviceId: string;
		deviceName: string;
	}): Promise<void>;
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
		input: OfferCaps & { spaceId: string; profile: string; deviceName: string },
	): Promise<void>;
	/** Withdraws this Device's Offer from a Space a Host keeps, through that Host. */
	withdrawOffer(input: { spaceId: string; profile: string }): Promise<void>;
	/** Keeps a file of a run this computer walks in the archive of the Host that keeps the Space. */
	archivePut(ref: ArchiveRef, content: string): Promise<void>;
	/**
	 * Starts a run placed on another Device through the Host that keeps
	 * the Space: the Host walks it. Returns the run's id; its rows follow
	 * by the exchange.
	 */
	startRun(
		input: StartRunInput & { spaceId: string; deviceId: string },
	): Promise<{ runId: string }>;
	/**
	 * The actor's Devices, as the Host that keeps the Space knows them:
	 * whether each is online and has a Clone of the project.
	 */
	devices(input: { spaceId: string; projectId: string }): Promise<OwnDevice[]>;
};
