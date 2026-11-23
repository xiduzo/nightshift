import type { ContractRouterClient } from "@orpc/contract";
import { archiveProcedures } from "./archive";
import { linkProcedures, pairingProcedures } from "./links";
import {
	personalSecretProcedures,
	projectSecretProcedures,
	spaceSecretProcedures,
} from "./secrets";
import { leaseProcedures, syncProcedures } from "./sync";
import { workProcedures } from "./work";

/**
 * The peer protocol: the procedures of a Host that a Device calls, written
 * once as an oRPC contract. Each procedure has its input and output
 * schemas, the Device key permission it needs, and its refusals.
 *
 * - The Host serves it: `hostRouter` (`host/adapters/in/host-router.ts`) implements it, and
 *   the API mounts that router at these paths (`/rpc/sync/push`).
 * - A Device calls it: `HostClient` is its client, over HTTPS
 *   (`links/host-client.ts`), or in memory on the same router in tests
 *   (`inMemoryHost`).
 *
 * The paths and the shapes are the wire format between daemons of
 * different versions: a Host from main serves Devices of older builds.
 * A change keeps what an older Device sends valid, and what it reads there.
 */

export const hostContract = {
	/** A paired Device's link: who the Host is, and the Device online while it answers. */
	link: linkProcedures,
	/**
	 * Pairing, as a joining Device calls it before it has a key. No key:
	 * the device authorization flow is the check (a Person approves the
	 * code on the Host).
	 */
	pairing: pairingProcedures,
	/**
	 * The event log exchange: run history in and out by cursor, live, the
	 * commands for the runs the Device walks, and what it asks of the
	 * Host's Spaces. The Host filters every call by the membership of the
	 * key's Person.
	 */
	sync: syncProcedures,
	/**
	 * The leases of the Spaces this Host keeps (ADR 7), for the runs a
	 * Device walks: the key's Device is their Walker, which renews them.
	 * Needs a role that may start runs in the Space. An older Host has
	 * none: a run of its Space cannot take a lease.
	 */
	leases: leaseProcedures,
	/** The archive: the run state of runs walked elsewhere, per Space, and live transcripts. */
	archive: archiveProcedures,
	/**
	 * The Personal secrets of the key's Person (ADR 13), which this Host
	 * keeps as their Home Host. Only a Device of that Person, paired here as
	 * its Home Host and with access, gets an answer: any other key is
	 * FORBIDDEN, and a Guest Host keeps none. A value goes to a Device for a
	 * use, and the Device keeps it in memory for that use only. An older
	 * Host has none: the Device says to update it.
	 */
	secrets: personalSecretProcedures,
	/**
	 * The secrets of the Projects of the Spaces this Host keeps (ADR 13).
	 * A Member's Device lists their names. One whose Person's role saves
	 * Flows sets, removes and moves them. Values go only to a Device with a
	 * step of a run of the Project placed on it now (`values`), or to a
	 * move (`take`). Any other key is FORBIDDEN. An older Host has none:
	 * the Device says to update it.
	 */
	projectSecrets: projectSecretProcedures,
	/** A Space's secrets (ADR 18). A step reads them through `projectSecrets.values`. */
	spaceSecrets: spaceSecretProcedures,
	/**
	 * The work relay: a placed Device takes the calls of the runs the Host
	 * walks on it, and a Walker calls another of its Person's Devices
	 * through the Host. The Host never dials a Device.
	 */
	devices: workProcedures,
};

/** The procedures of a Host as a Device calls them: the client of `hostContract`. */
export type HostClient = ContractRouterClient<typeof hostContract>;
