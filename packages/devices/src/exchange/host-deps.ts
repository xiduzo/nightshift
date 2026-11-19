import type { Permissions } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { Engine, PeerProjects, SpaceArchive } from "@nightshift/engine";
import { ORPCError } from "@orpc/server";
import type { OfferCaps, WorkReply, WorkRequest } from "../contract";
import type { HostSpaces } from "../links";
import type { WorkHub } from "../work";
import type { hostRunDoor } from "./host-run-door";
import type { RunHistoryExchange } from "./run-history";

/**
 * What the Host of run history takes (`createHostExchange`), and what its
 * procedure groups share. The Offers, the Offer admission and the Device
 * rows come as the shapes the exchange asks of them: the composition
 * (`wire-host.ts`) hands it the `offers` and `registry` verticals.
 */

/** The Offers of the Spaces, as the Host's procedures ask them (`EngineOffers` of `offers`). */
export type HostOffers = {
	/** The Offers a Space lists, every Device's. */
	list(spaceId: string): Promise<readonly { deviceId: string }[]>;
	/** Publishes an Offer (or its new caps) in the Space's document. */
	publish(
		input: OfferCaps & {
			spaceId: string;
			deviceId: string;
			deviceName: string;
			/** The profile's id. */
			profile: string;
			profileName: string;
			by: string | null;
		},
	): Promise<void>;
	/** Takes an Offer off the Space's document. */
	withdraw(input: {
		spaceId: string;
		deviceId: string;
		/** The profile's id. */
		profile: string;
		by: string | null;
	}): Promise<void>;
};

/** This Host's admission of a call of a run a Walker elsewhere walks (`OfferAdmission.serve` of `offers`). */
export type HostAdmission = {
	serve(
		request: WorkRequest,
		via: { keptHere: true },
		signal: AbortSignal,
	): AsyncIterable<WorkReply>;
};

/** The Devices paired here, as the Host's procedures ask them (`DeviceRegistry` of `registry`). */
export type HostDevices = {
	/** A paired Device: its owner, and whether its access is gone. Null: none. */
	get(
		id: string,
	): Promise<{ ownerId: string; revokedAt: number | null } | null>;
	/** What a paired Device says of itself when it links. */
	describe(
		id: string,
		facts: { name: string; dev: boolean; machine?: string | undefined },
	): Promise<void>;
};

export type HostExchangeDeps = {
	db: Database;
	/**
	 * This Host's engine (`PeerEngine`): its run history, the Offers of its
	 * Spaces, its admission of the calls of runs a Device walks with steps
	 * here, and its Projects, where a Device's Clone and the Projects of
	 * its personal Space are recorded. A Space a Host keeps (`hostSpaces`)
	 * is not this Host's to change.
	 */
	engine: Engine & {
		exchange: RunHistoryExchange;
		offers: HostOffers;
		admission: HostAdmission;
		projects: Pick<
			PeerProjects,
			| "recordClone"
			| "setClones"
			| "addFromRemote"
			| "defineWithoutFolder"
			| "matching"
			| "take"
		>;
		hostSpaces: Pick<HostSpaces, "hostOf">;
		/** Its Space archive: the knowledge content its Devices copy here, by hash (ADR 4). */
		archive: Pick<SpaceArchive, "here">;
	};
	/** The Devices paired here: the owners of the Walkers it serves, and what a Device says of itself. */
	registry: HostDevices;
	/** This Host's Device id: the Walker of its own runs. */
	selfId: string;
	/** The Person who owns this Host: the owner of its own Walker's paths. */
	ownerId: string;
	/** The calls of runs this Host walks, for the Devices they are placed on. */
	work: WorkHub;
};

/** What the procedure groups of the Host share: its deps, and the engine's run use cases in the Caller's name. */
export type HostShared = {
	deps: HostExchangeDeps;
	/** The engine's run use cases, in the name of the Caller's Person. */
	door: ReturnType<typeof hostRunDoor>;
};

/** The role every start of a run and every lease of a Space asks for. */
export const STARTS_RUNS: Permissions = { run: ["start"] };

/** Refuses the call: the Device may not do this. */
export function forbidden(message: string): never {
	throw new ORPCError("FORBIDDEN", { message });
}
