import { describe, expect, test } from "bun:test";
import {
	HostUnreachableError,
	type OwnDevice,
	type TranscriptEntry,
	HOST_UNREACHABLE as UNREACHABLE,
} from "@nightshift/engine";
import { createSandbox } from "@nightshift/engine/testing";
import type { HostClient, WorkReply, WorkRequest } from "../contract";
import type { DeviceLinks } from "../links";
import { pairedReplicas } from "../testing";
import { createRelay } from "./relay";
import { createSpaceRoutes } from "./route";
import { createWorkRelay } from "./work-relay";

/**
 * Where the relays send a call for a Space: here, to its Host over the
 * Link, or nowhere while the Host cannot be reached. The Links, the Host
 * and the hub are fakes, except in the last test: a real Host in memory.
 */

/** `space-own`: kept here. `space-team`: host-1, online. `space-gone`: host-2, no Link. `space-off`: host-3, its Link offline. */
const HOSTS: Record<string, string | null> = {
	"space-own": null,
	"space-team": "host-1",
	"space-gone": "host-2",
	"space-off": "host-3",
};

/** The Devices the Host lists, and the entry of its live transcript. */
const LISTED: OwnDevice[] = [
	{
		deviceId: "device-b",
		name: "B",
		thisDevice: false,
		online: true,
		hasClone: true,
	},
];
const ENTRY = {
	seq: 1,
	stepId: "step-1",
	sessionId: null,
	at: 1,
	event: { type: "text", text: "hello" },
} as unknown as TranscriptEntry;

/** One call the fake Host took: its procedure and its input. */
type Taken = { procedure: string; input: unknown };

/** A Host that records each call and answers as `answers` says. */
function fakeHost(
	answers: {
		replies?: () => AsyncIterable<WorkReply>;
		reachable?: () => Promise<boolean>;
	} = {},
) {
	const taken: Taken[] = [];
	const take =
		<O>(procedure: string, answer: O) =>
		async (input: unknown) => {
			taken.push({ procedure, input });
			return answer;
		};
	const client = {
		sync: {
			command: take("sync.command", undefined),
			addClone: take("sync.addClone", undefined),
			offer: take("sync.offer", undefined),
			withdrawOffer: take("sync.withdrawOffer", undefined),
			startRun: take("sync.startRun", { runId: "run-on-host" }),
			devices: take("sync.devices", LISTED),
		},
		archive: {
			get: take("archive.get", "from the Host"),
			put: take("archive.put", undefined),
			follow: async (input: unknown) => {
				taken.push({ procedure: "archive.follow", input });
				return (async function* () {
					yield ENTRY;
				})();
			},
		},
		devices: {
			call: async (input: unknown) => {
				taken.push({ procedure: "devices.call", input });
				return (answers.replies ?? noReplies)();
			},
			reachable: async (input: unknown) => {
				taken.push({ procedure: "devices.reachable", input });
				return (answers.reachable ?? (async () => true))();
			},
		},
	};
	return { client: client as unknown as HostClient, taken };
}

async function* noReplies(): AsyncIterable<WorkReply> {}

/** Links by Host: a client is an online Link, null an offline one, no key no Link. */
function fakeLinks(
	clients: Record<string, HostClient | null>,
): Pick<DeviceLinks, "get"> {
	return {
		get(hostId) {
			if (!(hostId in clients)) return undefined;
			const client = clients[hostId] ?? null;
			return {
				hostId,
				state: () => ({
					status: client ? "online" : "offline",
					address: client ? "fake" : null,
					since: 0,
				}),
				client: () => client,
				// The relays read `client()` only.
				stream: () => () => {},
				call: (use) =>
					client ? use(client) : Promise.reject(new Error("offline")),
				ready: async () => {
					if (!client) throw new Error("offline");
					return client;
				},
				check: () => {},
				close: async () => {},
			};
		},
	};
}

const hostSpaces = {
	hostOf: async (spaceId: string) => HOSTS[spaceId] ?? null,
};

function relayWith(host = fakeHost()) {
	const enqueued: unknown[] = [];
	const relay = createRelay({
		engine: () => ({
			exchange: {
				hostSpaces,
				commands: {
					enqueue: async (command) => {
						enqueued.push(command);
						return { id: "command-1" } as never;
					},
				},
			},
		}),
		registry: () => ({
			get: async (id) =>
				id === "walker-b"
					? ({ id, revokedAt: null } as never)
					: id === "walker-revoked"
						? ({ id, revokedAt: 1 } as never)
						: null,
		}),
		links: () => fakeLinks({ "host-1": host.client, "host-3": null }),
	});
	return { relay, host, enqueued };
}

const command = (spaceId: string, walkerId = "walker-b") => ({
	kind: "run.stop" as const,
	payload: {},
	spaceId,
	runId: "run-1",
	walkerId,
	personId: "person-1",
});

const ref = (spaceId: string) => ({
	kind: "transcript" as const,
	spaceId,
	runId: "run-1",
	stepId: "step-1",
});

const start = (spaceId: string) => ({
	flowId: "flow-1",
	projectId: "project-1",
	inputs: {},
	spaceId,
	deviceId: "device-b",
	startedBy: "person-1",
});

/** Each action of the relay on one Space, as a promise. */
function actions(relay: ReturnType<typeof createRelay>, spaceId: string) {
	return {
		command: () => relay.command(command(spaceId)),
		addClone: () =>
			relay.addClone({
				spaceId,
				projectId: "project-1",
				deviceId: "device-b",
				deviceName: "B",
			}),
		offer: () =>
			relay.offer({
				spaceId,
				profile: "claude",
				deviceName: "B",
				permissionCap: "default",
				sessionCap: 1,
			} as never),
		withdrawOffer: () => relay.withdrawOffer({ spaceId, profile: "claude" }),
		archivePut: () => relay.archivePut(ref(spaceId), "content"),
		startRun: () => relay.startRun(start(spaceId) as never),
		archive: () => relay.archive(ref(spaceId)),
		devices: () => relay.devices({ spaceId, projectId: "project-1" }),
		follow: async () => {
			const entries = relay.follow?.(
				{ spaceId, runId: "run-1", stepId: "step-1" },
				0,
				new AbortController().signal,
			);
			return entries?.[Symbol.asyncIterator]().next();
		},
	};
}

describe("the Space route", () => {
	const host = fakeHost();
	const routes = createSpaceRoutes({
		hostOf: hostSpaces.hostOf,
		links: () => fakeLinks({ "host-1": host.client, "host-3": null }),
	});

	test("says where a call for each Space goes now", async () => {
		expect(await routes.route("space-own")).toEqual({ at: "here" });
		expect(await routes.route("space-team")).toEqual({
			at: "host",
			hostId: "host-1",
			client: host.client,
		});
		// No Link to the Host, and a Link that is offline.
		expect(await routes.route("space-gone")).toEqual({
			at: "unreachable",
			hostId: "host-2",
		});
		expect(await routes.route("space-off")).toEqual({
			at: "unreachable",
			hostId: "host-3",
		});
	});

	test("reads the Link at each call", async () => {
		let client: HostClient | null = null;
		const live = createSpaceRoutes({
			hostOf: hostSpaces.hostOf,
			links: () => fakeLinks({ "host-1": client }),
		});
		expect((await live.route("space-team")).at).toBe("unreachable");
		client = host.client;
		expect((await live.route("space-team")).at).toBe("host");
	});

	test("the Host's procedures only while it can be reached", async () => {
		expect(await routes.host("space-team")).toBe(host.client);
		for (const spaceId of ["space-gone", "space-off", "space-own"]) {
			await expect(routes.host(spaceId)).rejects.toBeInstanceOf(
				HostUnreachableError,
			);
		}
	});
});

describe("the relay, while the Host of the Space cannot be reached", () => {
	for (const spaceId of ["space-gone", "space-off"]) {
		test(`every action refuses with one message (${spaceId})`, async () => {
			const { relay, host } = relayWith();
			for (const [name, act] of Object.entries(actions(relay, spaceId))) {
				const refused = await act().then(
					() => null,
					(error: unknown) => error,
				);
				expect(refused, name).toBeInstanceOf(HostUnreachableError);
				expect((refused as Error).message, name).toBe(UNREACHABLE);
			}
			expect(host.taken).toEqual([]);
		});
	}
});

describe("the relay, for a Space kept here", () => {
	test("reads answer with nothing: the caller has its own rows", async () => {
		const { relay, host } = relayWith();
		expect(await relay.archive(ref("space-own"))).toBeNull();
		expect(
			await relay.devices({ spaceId: "space-own", projectId: "p" }),
		).toEqual([]);
		expect(host.taken).toEqual([]);
	});

	test("a command waits here for its paired Walker", async () => {
		const { relay, enqueued, host } = relayWith();
		await relay.command(command("space-own"));
		expect(enqueued).toEqual([command("space-own")]);
		expect(host.taken).toEqual([]);
	});

	test("a command for a Walker that is not paired, or revoked, is refused", async () => {
		const { relay, enqueued } = relayWith();
		for (const walkerId of ["walker-unknown", "walker-revoked"]) {
			await expect(
				relay.command(command("space-own", walkerId)),
			).rejects.toThrow(
				"The device that runs this run has no access to this computer.",
			);
		}
		expect(enqueued).toEqual([]);
	});

	test("an action only a Host takes is refused", async () => {
		const { relay } = relayWith();
		const {
			command: _here,
			archive: _a,
			devices: _d,
			...hostOnly
		} = actions(relay, "space-own");
		for (const [name, act] of Object.entries(hostOnly)) {
			await expect(act(), name).rejects.toBeInstanceOf(HostUnreachableError);
		}
	});
});

describe("the relay, for a Space a Host keeps", () => {
	test("each call goes to the Host over its Link, shaped for it", async () => {
		const { relay, host, enqueued } = relayWith();
		const act = actions(relay, "space-team");
		await act.command();
		await act.addClone();
		await act.offer();
		await act.withdrawOffer();
		await act.archivePut();
		expect(await act.startRun()).toEqual({ runId: "run-on-host" });
		expect(await act.archive()).toBe("from the Host");
		expect(await act.devices()).toEqual(LISTED);
		const { startedBy: _person, ...startOnHost } = start("space-team");
		expect(host.taken).toEqual([
			// The Host acts in the name of the key's Person: the command goes as it is.
			{ procedure: "sync.command", input: command("space-team") },
			{
				procedure: "sync.addClone",
				input: {
					spaceId: "space-team",
					projectId: "project-1",
					deviceName: "B",
				},
			},
			{
				procedure: "sync.offer",
				input: {
					spaceId: "space-team",
					profile: "claude",
					deviceName: "B",
					permissionCap: "default",
					sessionCap: 1,
				},
			},
			{
				procedure: "sync.withdrawOffer",
				input: { spaceId: "space-team", profile: "claude" },
			},
			{
				procedure: "archive.put",
				input: { ref: ref("space-team"), content: "content" },
			},
			{ procedure: "sync.startRun", input: startOnHost },
			{ procedure: "archive.get", input: { ref: ref("space-team") } },
			{
				procedure: "sync.devices",
				input: { spaceId: "space-team", projectId: "project-1" },
			},
		]);
		expect(enqueued).toEqual([]);
	});

	test("a live transcript is the Host's", async () => {
		const { relay } = relayWith();
		const entries = [];
		for await (const entry of relay.follow?.(
			{ spaceId: "space-team", runId: "run-1", stepId: "step-1" },
			0,
			new AbortController().signal,
		) ?? []) {
			entries.push(entry);
		}
		expect(entries).toEqual([ENTRY]);
	});
});

const request = (spaceId: string): WorkRequest => ({
	spaceId,
	projectId: "project-1",
	personId: "person-1",
	runId: "run-1",
	call: { kind: "exec" } as WorkRequest["call"],
});

function workRelayWith(host = fakeHost()) {
	const hubCalls: string[] = [];
	const relay = createWorkRelay({
		hub: {
			async *call(deviceId) {
				hubCalls.push(deviceId);
				yield { kind: "result", value: "from the hub" };
			},
			online: (deviceId) => deviceId === "device-here",
		},
		engine: () => ({ exchange: { hostSpaces } }),
		links: () => fakeLinks({ "host-1": host.client, "host-3": null }),
	});
	return { relay, host, hubCalls };
}

async function repliesOf(
	replies: AsyncIterable<WorkReply>,
): Promise<WorkReply[]> {
	const all: WorkReply[] = [];
	for await (const reply of replies) all.push(reply);
	return all;
}

describe("the work relay", () => {
	test("a Space kept here: the hub serves the call", async () => {
		const { relay, hubCalls, host } = workRelayWith();
		expect(
			await repliesOf(relay.call("device-here", request("space-own"))),
		).toEqual([{ kind: "result", value: "from the hub" }]);
		expect(hubCalls).toEqual(["device-here"]);
		expect(await relay.online("device-here", "space-own")).toBe(true);
		expect(await relay.online("device-else", "space-own")).toBe(false);
		expect(host.taken).toEqual([]);
	});

	test("a Space a Host keeps: the Host's replies, in order", async () => {
		const host = fakeHost({
			async *replies() {
				yield { kind: "item", item: 1 };
				yield { kind: "result", value: 2 };
			},
		});
		const { relay, hubCalls } = workRelayWith(host);
		expect(
			await repliesOf(relay.call("device-b", request("space-team"))),
		).toEqual([
			{ kind: "item", item: 1 },
			{ kind: "result", value: 2 },
		]);
		expect(await relay.online("device-b", "space-team")).toBe(true);
		expect(host.taken).toEqual([
			{
				procedure: "devices.call",
				input: { deviceId: "device-b", request: request("space-team") },
			},
			{ procedure: "devices.reachable", input: { deviceId: "device-b" } },
		]);
		expect(hubCalls).toEqual([]);
	});

	test("the Host cannot be reached: one offline reply, and not online", async () => {
		const { relay } = workRelayWith();
		for (const spaceId of ["space-gone", "space-off"]) {
			expect(await repliesOf(relay.call("device-b", request(spaceId)))).toEqual(
				[{ kind: "error", message: UNREACHABLE, offline: true }],
			);
			expect(await relay.online("device-b", spaceId)).toBe(false);
		}
	});

	test("the Host stops answering: one offline reply", async () => {
		const host = fakeHost({
			// biome-ignore lint/correctness/useYield: the stream fails before its first reply.
			async *replies() {
				throw new Error("socket closed");
			},
			reachable: async () => {
				throw new Error("socket closed");
			},
		});
		const { relay } = workRelayWith(host);
		expect(
			await repliesOf(relay.call("device-b", request("space-team"))),
		).toEqual([
			{
				kind: "error",
				message:
					"The computer that keeps this Space stopped answering: socket closed",
				offline: true,
			},
		]);
		expect(await relay.online("device-b", "space-team")).toBe(false);
	});

	test("a call cancelled by its signal ends without a reply", async () => {
		const stop = new AbortController();
		const host = fakeHost({
			// biome-ignore lint/correctness/useYield: the stream fails before its first reply.
			async *replies() {
				stop.abort();
				throw new Error("aborted");
			},
		});
		const { relay } = workRelayWith(host);
		expect(
			await repliesOf(
				relay.call("device-b", request("space-team"), stop.signal),
			),
		).toEqual([]);
	});
});

describe("the relay of a paired Device", () => {
	test("reaches its Host in memory, and refuses while the Link is offline", async () => {
		const [a, b] = await Promise.all([createSandbox(), createSandbox()]);
		try {
			const paired = await pairedReplicas(a, b);
			const { id: projectId } = await paired.host
				.space(a.spaceId)
				.addProject({ repoPath: a.repoPath });
			const relayOver = (client: HostClient | null) =>
				createRelay({
					engine: () => paired.device,
					registry: () => paired.device.devices,
					links: () => fakeLinks({ [paired.hostId]: client }),
				});

			const online = relayOver(paired.memory.client(paired.key));
			const listed = await online.devices({ spaceId: a.spaceId, projectId });
			expect(listed.map((d) => d.deviceId)).toContain(b.deviceId);
			expect(await online.archive(ref(a.spaceId))).toBeNull();

			const offline = relayOver(null);
			await expect(
				offline.devices({ spaceId: a.spaceId, projectId }),
			).rejects.toBeInstanceOf(HostUnreachableError);
		} finally {
			await Promise.all([a.cleanup(), b.cleanup()]);
		}
	});
});
