import type { Relay } from "./contract";
import { parseRunFlow } from "./read";
import { createCommandRelay, createRunActions } from "./run";

type RunActionsDeps = Parameters<typeof createRunActions>[0];

/**
 * The actions block of the engine's composition (`wire.ts`): what a person
 * does to a run (`run/actions.ts`), and the Command that carries an action
 * to the Walker of a run another Device walks (`run/relay-commands.ts`).
 * Lane R4 of the hexagon series owns this file.
 *
 * It gives `actions`. The Space view reads `actions.act` and
 * `actions.moveTargets`.
 */
export function wireEngineActions(
	deps: Omit<RunActionsDeps, "relay" | "flowOf"> & {
		/** The Hosts this computer reaches (`Peers.relay`). Absent: none. */
		hosts?: Relay;
	},
) {
	const relay = createCommandRelay({
		...(deps.hosts ? { relay: deps.hosts } : {}),
	});

	const actions = createRunActions({
		db: deps.db,
		log: deps.log,
		artifacts: deps.artifacts,
		bus: deps.bus,
		runner: deps.runner,
		relay,
		archive: deps.archive,
		walks: deps.walks,
		device: deps.device,
		flowOf: parseRunFlow,
		placement: deps.placement,
		holds: deps.holds,
		leases: deps.leases,
		...(deps.usage ? { usage: deps.usage } : {}),
	});

	return { actions };
}
