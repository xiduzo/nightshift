import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `packages/devices` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_DEVICES: Record<string, Place> = {
	// The wire types of the peer protocol.
	contract: M,
	// Run history between a Replica and a Host, by cursor. It carries
	// rows and Commands, and the engine decides what they mean.
	exchange: M,
	// This computer as a Host: pairing, Device keys, presence.
	host: "devices",
	// The outbound connection to a Host. A port with its adapter.
	links: M,
	// This computer's membership of its home Host.
	membership: "devices",
	offers: "devices",
	// Pieces of the engine's `Peers` port. The composition
	// (`wire-peers.ts`) hands them the rows they read (rule 5).
	peers: M,
	// Which of a Person's Devices a run may use.
	placement: "devices",
	// Whom the daemon answers, and the certificates.
	reach: M,
	// The Device rows: this computer's own, and the paired ones.
	registry: "devices",
	// Carries actions and work to the Hosts.
	relay: M,
	secrets: "secrets",
	// The execution port for a Device behind a Host.
	work: M,
};
