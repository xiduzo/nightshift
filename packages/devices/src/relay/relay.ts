import { HostUnreachableError } from "@nightshift/engine";
import type { HostRelay } from "../contract";
import type { DeviceLinks } from "../links";
import type { PeerEngine } from "../peers";
import type { DeviceRegistry } from "../registry";
import { createSpaceRoutes } from "./route";

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
 */
export function createRelay(deps: {
	/** Lazy: the engine is made with this relay. */
	engine(): {
		exchange: {
			hostSpaces: Pick<PeerEngine["exchange"]["hostSpaces"], "hostOf">;
			commands: Pick<PeerEngine["exchange"]["commands"], "enqueue">;
		};
	};
	registry(): Pick<DeviceRegistry, "get">;
	links(): Pick<DeviceLinks, "get">;
}): HostRelay {
	const { route, host } = createSpaceRoutes({
		hostOf: (spaceId) => deps.engine().exchange.hostSpaces.hostOf(spaceId),
		links: deps.links,
	});

	return {
		async command(command) {
			const to = await route(command.spaceId);
			if (to.at === "unreachable") throw new HostUnreachableError();
			if (to.at === "host") {
				// The Host acts in the name of the key's Person, never a Person the call names.
				await to.client.sync.command(command);
				return;
			}
			const walker = await deps.registry().get(command.walkerId);
			if (!walker || walker.revokedAt) {
				throw new Error(
					"The device that runs this run has no access to this computer.",
				);
			}
			await deps.engine().exchange.commands.enqueue(command);
		},

		async addClone({ spaceId, projectId, deviceName }) {
			await (await host(spaceId)).sync.addClone({
				spaceId,
				projectId,
				deviceName,
			});
		},

		async offer(input) {
			// The Host publishes it for the key's Device, in its Person's name.
			await (await host(input.spaceId)).sync.offer(input);
		},

		async withdrawOffer(input) {
			await (await host(input.spaceId)).sync.withdrawOffer(input);
		},

		async archive(ref) {
			const to = await route(ref.spaceId);
			if (to.at === "unreachable") throw new HostUnreachableError();
			return to.at === "host" ? to.client.archive.get({ ref }) : null;
		},

		async *follow(step, afterSeq, signal) {
			const client = await host(step.spaceId);
			yield* await client.archive.follow({ step, afterSeq }, { signal });
		},

		async archivePut(ref, content) {
			await (await host(ref.spaceId)).archive.put({ ref, content });
		},

		async startRun(input) {
			// The Host starts it in the name of the key's Person.
			const { startedBy: _person, ...start } = input;
			return (await host(input.spaceId)).sync.startRun(start);
		},

		async devices(input) {
			const to = await route(input.spaceId);
			if (to.at === "unreachable") throw new HostUnreachableError();
			return to.at === "host" ? to.client.sync.devices(input) : [];
		},
	};
}
