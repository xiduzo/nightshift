import type { RunSummary } from "@nightshift/engine";
import type { OfferCaps } from "../contract";

/** A run of another Person that ran (or runs) on this computer through an Offer. */
export type OfferRun = {
	id: string;
	title: string;
	status: RunSummary["status"];
	/** The Person who started it, as this computer knows them. */
	startedBy: string | null;
	createdAt: number;
};

/** One of this computer's Offers, for its owner. */
export type OfferView = OfferCaps & {
	spaceId: string;
	spaceName: string;
	/** The profile's id. */
	profile: string;
	profileName: string;
	offeredAt: number;
	/** The Space still lists it. False: it was withdrawn there, and runs no longer use it. */
	listed: boolean;
	/** "Runs for <Space>": the runs of other Persons on this computer in that Space, newest first. */
	runs: OfferRun[];
};

/**
 * A Device of a Space, as any Member sees it: its name, its owner,
 * whether it is online, which of the Space's Projects it has a Clone of,
 * and the profiles it offers. Nothing else of the Device.
 */
export type SpaceDeviceView = {
	id: string;
	name: string;
	/** Null when this computer cannot tell (it is not the Space's Host). */
	online: boolean | null;
	thisDevice: boolean;
	/** One of the Person's own Devices: this computer, or one of theirs the Space knows. */
	mine: boolean;
	/** Its owner's name in the Space. Null when this computer cannot tell. */
	owner: string | null;
	/** `process.platform`. Null when this computer cannot tell. */
	platform: string | null;
	/** Epoch ms of its last connection. Null when this computer cannot tell. */
	lastSeenAt: number | null;
	clones: { projectId: string; projectName: string }[];
	/** `profile`: the profile's id. */
	offers: (OfferCaps & { profile: string; profileName: string })[];
};

/**
 * A Space this computer's owner can offer its profiles to: a shared Space
 * where their role allows it, or, on a Host, the personal Space of a
 * Person whose home Host it is ("Personal of Ada").
 */
export type OfferSpace = { id: string; name: string; personal: boolean };

/** This computer's Offers into Spaces, made by its owner. */
export type Offers = {
	/** Its Offers, every Space, oldest first. */
	list(): Promise<OfferView[]>;
	/** The Spaces it can offer to: the shared ones, then the personal ones, by name. */
	spaces(): Promise<OfferSpace[]>;
	/**
	 * Offers one of its profiles (`profile`: its id) to a Space, or changes
	 * the caps. Only to a Space of `spaces()`.
	 */
	make(
		input: OfferCaps & { spaceId: string; profile: string },
		by: string,
	): Promise<void>;
	/**
	 * Shows a profile's new name in the Spaces that list its Offers. Each
	 * Offer keeps its caps. A Space that cannot be reached keeps the old
	 * name until the next change of the Offer.
	 */
	renamed(profileId: string, by: string): Promise<void>;
	/**
	 * Withdraws it: the Space no longer lists it, its running steps end as
	 * stopped, and this computer takes no more work under it.
	 */
	withdraw(
		input: { spaceId: string; profile: string },
		by: string,
	): Promise<void>;
	/**
	 * The Devices of a Space as its Members see them (`SpaceDeviceView`),
	 * for the Person of the session: `mine` marks theirs.
	 */
	spaceDevices(spaceId: string, personId: string): Promise<SpaceDeviceView[]>;
};
