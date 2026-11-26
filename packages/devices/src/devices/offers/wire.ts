import { roleAllows, wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type {
	Device,
	DeviceDocument,
	Engine,
	OwnDevice,
	PeerContext,
	PeerProjects,
	SpaceDocuments,
} from "@nightshift/engine";
import {
	flowsForRun,
	HostUnreachableError,
	memberRole,
	NIGHT_SHIFT,
	worktreeLocation,
} from "@nightshift/engine";
import type { ProfileStore } from "@nightshift/engine/settings";
import { isAgentProfile, type ProfileSettings } from "@nightshift/flows";
import { now as timeNow } from "@nightshift/time";
import type { HostRelay, OfferCaps } from "../../contract";
import { createHostSpaces, personInSpace, personOnHost } from "../../links";
import { remoteDevice, serveWork } from "../../work";
import type { DeviceRegistry } from "../registry";
import { yjsDeviceOffers } from "./adapters/out/yjs-device-offers";
import type { OfferAdmission } from "./application/admit-offered-call";
import { admitOfferedCall } from "./application/admit-offered-call";
import { checkScheduleOffers } from "./application/check-schedule-offers";
import type { OfferSpace } from "./application/list-offer-spaces";
import { listOfferSpaces } from "./application/list-offer-spaces";
import type { OfferView } from "./application/list-offers";
import { listOffers } from "./application/list-offers";
import type { SpaceDeviceView } from "./application/list-space-devices";
import { listSpaceDevices } from "./application/list-space-devices";
import { makeOffer } from "./application/make-offer";
import { noteProfileRenamed } from "./application/note-profile-renamed";
import type {
	HostSpaces,
	Memberships,
	Profiles,
	Registry,
	SpaceReads,
} from "./application/ports";
import { publishOffer } from "./application/publish-offer";
import { retractOffer } from "./application/retract-offer";
import { withdrawOffer } from "./application/withdraw-offer";
import { createOfferUse, type OfferUse } from "./domain/offer-use";
import {
	type OfferedSessions,
	type OfferRef,
	createOfferedSessions as openOfferedSessions,
} from "./domain/offered-sessions";
import { type DeviceOffer, spaceOffers } from "./domain/offers";

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
	 * The Devices of a Space as its Members see them, for the Person of
	 * the session: `mine` marks theirs.
	 */
	spaceDevices(spaceId: string, personId: string): Promise<SpaceDeviceView[]>;
};

/**
 * The Offers as the Space documents publish them. Who may make or
 * withdraw one is the caller's check. The Device's own entry is its
 * owner's.
 */
export type EngineOffers = {
	/** The Offers a Space lists, every Device's. */
	list(spaceId: string): Promise<ReturnType<typeof spaceOffers>>;
	/**
	 * Publishes an Offer (or its new caps) in the Space's document and logs
	 * it there. A Space a Host keeps: through that Host.
	 */
	publish(
		input: OfferCaps & {
			spaceId: string;
			deviceId: string;
			deviceName: string;
			profile: string;
			profileName: string;
			by: string | null;
		},
	): Promise<void>;
	/**
	 * Takes an Offer off the Space's document, logs it, and stops the runs
	 * walked here whose running step is a session under it. A Space a Host
	 * keeps: through that Host, and the runs walked here stop also when it
	 * cannot be reached. Nothing to withdraw is no error.
	 */
	withdraw(input: {
		spaceId: string;
		deviceId: string;
		profile: string;
		by: string | null;
	}): Promise<void>;
};

export type { OfferAdmission, OfferUse };

/** What the owner's door takes. */
export type OwnerDeps = {
	db: Database;
	engine: Engine & {
		offers: EngineOffers;
		devices: Pick<DeviceRegistry, "get" | "homePersons">;
		members: {
			name(spaceId: string, personId: string): Promise<string | null>;
		};
	};
	document: DeviceDocument;
	profiles: ProfileStore;
	self: { id: string; name: string };
	ownerId: string;
	withdrawn(spaceId: string, profile: string): void;
};

/** What publishing an Offer in a Space document takes. */
export type PublicationDeps = {
	ready: Promise<unknown>;
	documents: SpaceDocuments;
	logFact: PeerContext["logFact"];
	deviceId: string;
	now(): number;
	hostOf(spaceId: string): Promise<string | null>;
	relay?: Pick<HostRelay, "offer" | "withdrawOffer">;
	stopUnder(offer: OfferRef): Promise<void>;
};

/** What the admission of a call takes. */
export type AdmissionDeps = {
	db: Database;
	selfOwnerId: () => Promise<string | null>;
	device: Device;
	documents: SpaceDocuments;
	projects: Pick<PeerProjects, "clonePath" | "find">;
	runFolders: PeerContext["runFolders"];
	ownOffers?: () => readonly DeviceOffer[];
	profileFor?: (id: string) => ProfileSettings | null;
	sessions?: Pick<OfferedSessions, "relay">;
	use?: OfferUse;
};

/** What a schedule's Offer check takes. */
export type ScheduleDeps = {
	db: Database;
	documents: SpaceDocuments;
	devicesFor(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<OwnDevice[]>;
	keeper(spaceId: string): Promise<string>;
	offersHere(spaceId: string): Promise<DeviceOffer[]>;
	mayUseOffers?: (spaceId: string, personId: string) => Promise<boolean>;
};

/**
 * The wiring of offers. One function builds the owner's door, the
 * publication in Space documents, the admission of a call, and the
 * schedule check. Each takes the pieces its caller has.
 */
export function wireOffers(ground: { now?: () => number } = {}) {
	const now = ground.now ?? timeNow;

	function membershipsOf(db: Database): Memberships {
		const spaces = wireSpaces({ db });
		return {
			spacesOf: (personId) => spaces.listSpaces({ personId }),
			roleAllows,
			personNames: (ids) => spaces.members.listPersonNames({ ids }),
			personalSpaceIdBySlug: (personId) =>
				spaces.personal.findPersonalSpaceBySlug({ personId }),
			personInSpace: (spaceId, personId) =>
				personInSpace(db, spaceId, personId),
		};
	}

	function profilesOf(profiles: ProfileStore): Profiles {
		return {
			get: (id) => {
				const found = profiles.get(id);
				return found ? { id: found.id, name: found.name } : null;
			},
			agent: (id) => {
				const found = profiles.get(id);
				if (!found || !isAgentProfile(found)) return null;
				return { id: found.id, name: found.name };
			},
		};
	}

	return {
		/** The offered sessions running now. One per engine. */
		createOfferedSessions(): OfferedSessions {
			return openOfferedSessions();
		},

		/** This computer's Offers, as its owner makes and withdraws them. */
		createOffers(deps: OwnerDeps): Offers {
			const { hostOf } = createHostSpaces(deps.db);
			const hostSpaces: HostSpaces = { hostOf };
			const registry: Pick<Registry, "get" | "homePersons"> = {
				get: (id) => deps.engine.devices.get(id),
				homePersons: () => deps.engine.devices.homePersons(),
			};
			const spaceReads: SpaceReads = {
				listRuns: (spaceId) =>
					deps.engine.space(spaceId, NIGHT_SHIFT).listRuns(),
				listProjects: (spaceId) =>
					deps.engine.space(spaceId, NIGHT_SHIFT).listProjects(),
				memberName: (spaceId, personId) =>
					deps.engine.members.name(spaceId, personId),
			};
			const shared = {
				deviceOffers: yjsDeviceOffers(deps.document),
				spaceOffers: deps.engine.offers,
				memberships: membershipsOf(deps.db),
				profiles: profilesOf(deps.profiles),
				hostSpaces,
				registry,
				self: deps.self,
				ownerId: deps.ownerId,
			};
			const list = listOffers({ ...shared, spaceReads });
			const spaces = listOfferSpaces(shared);
			const make = makeOffer({ ...shared, now });
			const renamed = noteProfileRenamed(shared);
			const withdraw = withdrawOffer({
				...shared,
				abort: { withdrawn: deps.withdrawn },
			});
			const spaceDevices = listSpaceDevices({
				spaceOffers: shared.spaceOffers,
				spaceReads,
				memberships: shared.memberships,
				registry,
				self: deps.self,
				ownerId: deps.ownerId,
			});
			return {
				list,
				spaces,
				make,
				renamed,
				withdraw,
				spaceDevices,
			};
		},

		/** Publishes and withdraws Offers in the Space documents. */
		createEngineOffers(deps: PublicationDeps): EngineOffers {
			const unreachable = (): never => {
				throw new HostUnreachableError();
			};
			const open = (spaceId: string) => deps.documents.open(spaceId);
			return {
				async list(spaceId) {
					await deps.ready;
					return spaceOffers(await deps.documents.open(spaceId));
				},
				publish: publishOffer({
					ready: deps.ready,
					open,
					hostOf: deps.hostOf,
					deviceId: deps.deviceId,
					now: deps.now,
					...(deps.relay ? { relay: deps.relay } : {}),
					unreachable,
					logMade: async (spaceId, offer) => {
						await deps.logFact({
							type: "OfferMade",
							spaceId,
							payload: {
								deviceId: offer.deviceId,
								deviceName: offer.deviceName,
								profile: offer.profile,
								profileName: offer.profileName,
								permissionCap: offer.permissionCap,
								sessionCap: offer.sessionCap,
								by: offer.by,
							},
						});
					},
				}),
				withdraw: retractOffer({
					ready: deps.ready,
					open,
					hostOf: deps.hostOf,
					deviceId: deps.deviceId,
					...(deps.relay ? { relay: deps.relay } : {}),
					unreachable,
					stopUnder: deps.stopUnder,
					logWithdrawn: async (input) => {
						await deps.logFact({
							type: "OfferWithdrawn",
							spaceId: input.spaceId,
							payload: {
								deviceId: input.deviceId,
								profile: input.profile,
								by: input.by,
							},
						});
					},
				}),
			};
		},

		/** Every check of a call of another Person's run, both paths. */
		createOfferAdmission(deps: AdmissionDeps): OfferAdmission {
			return admitOfferedCall({
				selfOwnerId: deps.selfOwnerId,
				device: deps.device,
				documents: deps.documents,
				hostOf: createHostSpaces(deps.db).hostOf,
				personInSpace: (spaceId, personId) =>
					personInSpace(deps.db, spaceId, personId),
				personOnHost: (spaceId) => personOnHost(deps.db, spaceId),
				memberRole,
				roleAllows,
				projects: deps.projects,
				runFolders: deps.runFolders,
				worktreeOf: worktreeLocation,
				...(deps.ownOffers ? { ownOffers: deps.ownOffers } : {}),
				...(deps.profileFor ? { profileFor: deps.profileFor } : {}),
				...(deps.sessions ? { sessions: deps.sessions } : {}),
				use: deps.use ?? createOfferUse(),
				serve: serveWork,
				remote: (relay, device, forRun) => remoteDevice(relay, device, forRun),
			});
		},

		/** The Offer check a schedule passes before its runs start. */
		createScheduleOffers(deps: ScheduleDeps) {
			return checkScheduleOffers({
				documents: deps.documents,
				devicesFor: deps.devicesFor,
				keeper: deps.keeper,
				offersHere: deps.offersHere,
				...(deps.mayUseOffers ? { mayUseOffers: deps.mayUseOffers } : {}),
				personInSpace: (spaceId, personId) =>
					personInSpace(deps.db, spaceId, personId),
				flowsForRun,
			});
		},
	};
}
