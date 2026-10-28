import { type FlowDocuments, HostUnreachableError } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import type { HostRelay } from "../contract";
import { type DeviceLinks, fromHost } from "../links";
import type { PeerEngine } from "../peers";
import type { DeviceRegistry } from "../registry";
import { createSpaceRoutes } from "./route";

/** How long a run start waits for the project's flows to reach the Host. */
const FLOW_SYNC_MS = 10_000;
const FLOW_SYNC_POLL_MS = 100;

/**
 * The engine's `Relay`: the actions on rows another Device owns, carried
 * to the right place (`createSpaceRoutes`).
 *
 * - A Space this Replica keeps (it is that Space's Host): a command waits
 *   here for its Walker, a paired Device, which takes it over its link.
 *   A read answers with nothing: the caller read its own rows first.
 * - A Space a Host keeps: the call goes to that Host over its link, with
 *   this Device's key; the Host checks the role of the key's Person.
 * - A Host that cannot be reached: every call throws
 *   `HostUnreachableError`. The person tries again later.
 *
 * The Host's errors come back in this computer's words (`fromHost`): its
 * refusals keep their words and their kind, and a key the Host no longer
 * knows asks the person to pair this computer again.
 */
export function createRelay(deps: {
	/** Lazy: the engine is made with this relay. */
	engine(): {
		hostSpaces: Pick<PeerEngine["hostSpaces"], "hostOf">;
		exchange: { commands: Pick<PeerEngine["exchange"]["commands"], "enqueue"> };
	};
	registry(): Pick<DeviceRegistry, "get">;
	links(): Pick<DeviceLinks, "get">;
	/** The flow documents of this Replica: a run starts on the Host from its copy. */
	flows: Pick<FlowDocuments, "open">;
	/** How long a run start waits for the project's flows to reach the Host. Default 10 s. */
	flowSyncMs?: number;
	/** Default `Date.now`. */
	now?(): number;
}): HostRelay {
	const now = deps.now ?? Date.now;
	const { route, onHost } = createSpaceRoutes({
		hostOf: (spaceId) => deps.engine().hostSpaces.hostOf(spaceId),
		links: deps.links,
	});

	/**
	 * Waits until the Host has the project's flows as this computer has
	 * them: the Host starts the run from its own copy, so a flow saved here
	 * a moment ago must reach it first. Refuses when they do not arrive in
	 * time.
	 */
	async function flowsOnHost(hostId: string, projectId: string) {
		const link = deps.links().get(hostId);
		if (!link) throw new HostUnreachableError();
		const { current, history } = await deps.flows.open(projectId);
		const synced = () => link.synced(current.name) && link.synced(history.name);
		if (synced()) return;
		link.check();
		const end = now() + (deps.flowSyncMs ?? FLOW_SYNC_MS);
		while (now() < end) {
			await Bun.sleep(FLOW_SYNC_POLL_MS);
			if (synced()) return;
		}
		throw new Refusal(
			"unavailable",
			"The flows of this project have not reached the computer that keeps this Space yet. Start the run again in a moment.",
		);
	}

	return {
		async command(command) {
			const to = await route(command.spaceId);
			if (to.at === "unreachable") throw new HostUnreachableError();
			if (to.at === "host") {
				// The Host acts in the name of the key's Person, never a Person the call names.
				await to.ask((client) => client.sync.command(command));
				return;
			}
			const walker = await deps.registry().get(command.walkerId);
			if (!walker || walker.revokedAt) {
				throw new Refusal(
					"conflict",
					"The device that runs this run has no access to this computer.",
				);
			}
			await deps.engine().exchange.commands.enqueue(command);
		},

		async addClone({ spaceId, projectId, deviceName }) {
			await onHost(spaceId, (client) =>
				client.sync.addClone({ spaceId, projectId, deviceName }),
			);
		},

		async offer(input) {
			// The Host publishes it for the key's Device, in its Person's name.
			await onHost(input.spaceId, (client) => client.sync.offer(input));
		},

		async withdrawOffer(input) {
			await onHost(input.spaceId, (client) => client.sync.withdrawOffer(input));
		},

		async archive(ref) {
			const to = await route(ref.spaceId);
			if (to.at === "unreachable") throw new HostUnreachableError();
			return to.at === "host"
				? to.ask((client) => client.archive.get({ ref }))
				: null;
		},

		async *follow(step, afterSeq, signal) {
			const entries = await onHost(step.spaceId, (client) =>
				client.archive.follow({ step, afterSeq }, { signal }),
			);
			try {
				yield* entries;
			} catch (error) {
				throw fromHost(error);
			}
		},

		async archivePut(ref, content, stamp) {
			await onHost(ref.spaceId, (client) =>
				client.archive.put({ ref, content, ...(stamp ? { stamp } : {}) }),
			);
		},

		async startRun(input) {
			// The Host starts it in the name of the key's Person.
			const { startedBy: _person, ...start } = input;
			const to = await route(input.spaceId);
			if (to.at !== "host") throw new HostUnreachableError();
			// A run of a saved flow starts from the Host's copy of it; a quick run carries its flow.
			if ("flowName" in input) await flowsOnHost(to.hostId, input.projectId);
			return to.ask((client) => client.sync.startRun(start));
		},

		async devices(input) {
			const to = await route(input.spaceId);
			if (to.at === "unreachable") throw new HostUnreachableError();
			return to.at === "host"
				? to.ask((client) => client.sync.devices(input))
				: [];
		},
	};
}
