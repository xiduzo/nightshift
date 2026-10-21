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
	profile: string;
	offeredAt: number;
	/** The Space still lists it. False: it was withdrawn there, and runs no longer use it. */
	listed: boolean;
	/** "Runs for <Space>": the runs of other Persons on this computer in that Space, newest first. */
	runs: OfferRun[];
};

/**
 * A Device of a Space, as any Member sees it: its name, whether it is
 * online, which of the Space's Projects it has a Clone of, and the
 * profiles it offers. Nothing else of the Device.
 */
export type SpaceDeviceView = {
	id: string;
	name: string;
	/** Null when this computer cannot tell (it is not the Space's Host). */
	online: boolean | null;
	thisDevice: boolean;
	clones: { projectId: string; projectName: string }[];
	offers: (OfferCaps & { profile: string })[];
};

/** This computer's Offers into Spaces, made by its owner. */
export type Offers = {
	/** Its Offers, every Space, oldest first. */
	list(): Promise<OfferView[]>;
	/** Offers one of its profiles to a Space, or changes the caps. */
	make(
		input: OfferCaps & { spaceId: string; profile: string },
		by: string,
	): Promise<void>;
	/**
	 * Withdraws it: the Space no longer lists it, its running steps end as
	 * stopped, and this computer takes no more work under it.
	 */
	withdraw(
		input: { spaceId: string; profile: string },
		by: string,
	): Promise<void>;
	/** The Devices of a Space as its Members see them (`SpaceDeviceView`). */
	spaceDevices(spaceId: string): Promise<SpaceDeviceView[]>;
};
