import type { RunSummary } from "@nightshift/engine";
import type { OfferCaps } from "../../contract";
import { listOfferSpaces } from "./list-offer-spaces";
import type {
	DeviceOffers,
	HostSpaces,
	Memberships,
	Profiles,
	Registry,
	SpaceOffers,
	SpaceReads,
} from "./ports";

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

export type ListOffersPorts = {
	deviceOffers: DeviceOffers;
	spaceOffers: Pick<SpaceOffers, "list">;
	memberships: Memberships;
	profiles: Profiles;
	hostSpaces: HostSpaces;
	registry: Pick<Registry, "homePersons">;
	spaceReads: SpaceReads;
	self: { id: string };
	ownerId: string;
};

/** This computer's Offers, every Space, oldest first. */
export const listOffers =
	(ports: ListOffersPorts) => async (): Promise<OfferView[]> => {
		const nameOrId = (profile: string) =>
			ports.profiles.get(profile)?.name ??
			ports.profiles.byName(profile)?.name ??
			profile;
		const views: OfferView[] = [];
		const offerable = await listOfferSpaces(ports)();
		const spaceNameOf = async (spaceId: string) =>
			offerable.find((s) => s.id === spaceId)?.name ??
			(await ports.memberships.spacesOf(ports.ownerId)).find(
				(s) => s.id === spaceId,
			)?.name ??
			"A Space you left";

		for (const offer of ports.deviceOffers.list(nameOrId)) {
			const listed = (await ports.spaceOffers.list(offer.spaceId)).some(
				(o) => o.deviceId === ports.self.id && o.profile === offer.profile,
			);
			const me = await ports.memberships.personInSpace(
				offer.spaceId,
				ports.ownerId,
			);
			const runs = [];
			for (const r of (await ports.spaceReads.listRuns(offer.spaceId))
				.filter(
					(r) =>
						r.device.id === ports.self.id &&
						r.startedBy !== null &&
						r.startedBy.id !== me,
				)
				.slice(0, 10)) {
				runs.push({
					id: r.id,
					title: r.title,
					status: r.status,
					startedBy:
						r.startedBy?.name ??
						(r.startedBy
							? await ports.spaceReads.memberName(offer.spaceId, r.startedBy.id)
							: null),
					createdAt: r.createdAt,
				});
			}
			views.push({
				...offer,
				spaceName: await spaceNameOf(offer.spaceId),
				listed,
				runs,
			});
		}
		return views;
	};
