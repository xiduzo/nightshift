import {
	type FlowDocuments,
	HostUnreachableError,
	OlderHostError,
	type WalkFile,
} from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import type { HostClient, HostRelay, InStep } from "../contract";
import type { RunCommands } from "../exchange";
import {
	type DeviceLinks,
	fromHost,
	type HostSpaces,
	isOlderHost,
} from "../links";
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
 *
 * The Host's errors come back in this computer's words (`fromHost`): its
 * refusals keep their words and their kind, and a key the Host no longer
 * knows asks the person to pair this computer again.
 */
/**
 * A knowledge call to a Host: a Host of a version before knowledge in the
 * Space (ADR 4) does not know the procedure, and says so as a Host of an
 * older version does (`isOlderHost`). That is `OlderHostError`, not a
 * failed sync. Its other errors in this computer's words (`fromHost`).
 */
async function knowledgeCall<T>(
	client: HostClient,
	use: (client: HostClient) => Promise<T>,
): Promise<T> {
	try {
		return await use(client);
	} catch (error) {
		if (isOlderHost(error)) throw new OlderHostError();
		throw fromHost(error);
	}
}

/** What a run reads when the Host that keeps its Space does not know leases. */
export const OLDER_HOST_LEASES =
	"The computer that keeps this Space runs an older version of Night Shift. Update Night Shift there to use a Lease node.";

/**
 * A lease call to the Host that keeps the Space (ADR 7). A Host of a
 * version before leases does not know the procedure: the run reads that
 * it must update the Host. A call the network cuts is a Host that cannot
 * be reached, so the run waits for it, as it does without a Link.
 */
async function leaseCall<T>(
	client: HostClient,
	use: (client: HostClient) => Promise<T>,
): Promise<T> {
	try {
		return await use(client);
	} catch (error) {
		if (isOlderHost(error)) throw new Refusal("unavailable", OLDER_HOST_LEASES);
		const mine = fromHost(error);
		if (mine instanceof Refusal) throw mine;
		throw new HostUnreachableError();
	}
}

export function createRelay(deps: {
	/** Lazy: the engine is made with this relay. */
	engine(): {
		hostSpaces: Pick<HostSpaces, "hostOf">;
		exchange: { commands: Pick<RunCommands, "enqueue"> };
	};
	registry(): Pick<DeviceRegistry, "get">;
	links(): Pick<DeviceLinks, "get">;
	/** The flow documents of this Replica: a run starts on the Host from its copy. */
	flows: Pick<FlowDocuments, "open">;
	/** How long a run start waits for the project's flows to reach the Host. Default 10 s. */
	flowSyncMs?: number;
}): HostRelay {
	const { route, onHost } = createSpaceRoutes({
		hostOf: (spaceId) => deps.engine().hostSpaces.hostOf(spaceId),
		links: deps.links,
	});

	async function inStep(
		spaceId: string,
		names: readonly string[],
		options?: { timeoutMs?: number; signal?: AbortSignal },
	): Promise<InStep> {
		const to = await route(spaceId);
		if (to.at === "here") return "in step";
		const link = to.at === "host" ? deps.links().get(to.hostId) : undefined;
		if (!link) return "unreachable";
		return (await link.inStep(names, options)) ? "in step" : "timed out";
	}

	/** The client of the Host that keeps the Space. Throws when that Host cannot be reached. */
	async function hostClient(spaceId: string): Promise<HostClient> {
		const to = await route(spaceId);
		if (to.at !== "host") throw new HostUnreachableError();
		return to.client;
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

		async archiveGet(ref) {
			const to = await route(ref.spaceId);
			if (to.at === "unreachable") throw new HostUnreachableError();
			if (to.at === "here") return null;
			if (ref.kind !== "content") {
				return to.ask((client) => client.archive.get({ ref }));
			}
			// Knowledge content travels in base64.
			const { spaceId, sha256 } = ref;
			const content = await knowledgeCall(to.client, (client) =>
				client.archive.knowledgeGet({ spaceId, sha256 }),
			);
			return content === null
				? null
				: new Uint8Array(Buffer.from(content, "base64"));
		},

		async archivePut(entry) {
			const to = await route(entry.ref.spaceId);
			if (to.at === "unreachable") throw new HostUnreachableError();
			if (to.at === "here") return false;
			if (entry.ref.kind === "content") {
				const { spaceId, sha256 } = entry.ref;
				const content = Buffer.from(entry.content as Uint8Array).toString(
					"base64",
				);
				await knowledgeCall(to.client, (client) =>
					client.archive.knowledgePut({ spaceId, sha256, content }),
				);
			} else {
				const { ref, content, stamp } = entry as WalkFile;
				await to.ask((client) =>
					client.archive.put({ ref, content, ...(stamp ? { stamp } : {}) }),
				);
			}
			return true;
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

		inStep,

		async reachable(spaceId) {
			return (await route(spaceId)).at === "host";
		},

		async startRun(input) {
			// The Host starts it in the name of the key's Person.
			const { startedBy: _person, ...start } = input;
			const to = await route(input.spaceId);
			if (to.at !== "host") throw new HostUnreachableError();
			// A run of a saved flow starts from the Host's copy of it, so a flow
			// saved here a moment ago must reach it first. A quick run carries its flow.
			if ("flowName" in input) {
				const { current, history } = await deps.flows.open(input.projectId);
				const flows = await inStep(
					input.spaceId,
					[current.name, history.name],
					{
						...(deps.flowSyncMs ? { timeoutMs: deps.flowSyncMs } : {}),
					},
				);
				if (flows === "unreachable") throw new HostUnreachableError();
				if (flows === "timed out") {
					throw new Refusal(
						"unavailable",
						"The flows of this project are not on the computer that keeps this Space yet. Start the run again in a moment.",
					);
				}
			}
			return to.ask((client) => client.sync.startRun(start));
		},

		leases: {
			async take({ walkerId: _walker, ...take }) {
				// The Host takes it for the key's Device, its Walker.
				return leaseCall(await hostClient(take.spaceId), (client) =>
					client.leases.take(take),
				);
			},
			async renew({ spaceId, runId, names }) {
				return leaseCall(await hostClient(spaceId), (client) =>
					client.leases.renew({ spaceId, runId, names: [...names] }),
				);
			},
			async release({ spaceId, runId, names }) {
				await leaseCall(await hostClient(spaceId), (client) =>
					client.leases.release({
						spaceId,
						runId,
						...(names ? { names: [...names] } : {}),
					}),
				);
			},
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
