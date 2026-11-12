import { describe, expect, test } from "bun:test";
import type { SyncAccess } from "@nightshift/auth";
import { HostUnreachableError, OlderHostError } from "@nightshift/engine";
import { now } from "@nightshift/time";
import { ORPCError } from "@orpc/client";
import * as Y from "yjs";
import type { HostClient, HostHello } from "../contract";
import { memoryDocuments, partialHostClient } from "../testing";
import { NotPairedError } from "./from-host";
import type { HostLink } from "./host-links";
import { firstAnswering, httpsLink, type LinkState } from "./link";

/**
 * The Link's own logic, over fake Hosts: no network. The fake Hosts
 * answer as the wire does (`ORPCError`): what the link hands out answers
 * in this computer's words.
 */

const LINK: HostLink = {
	hostId: "host-a",
	name: "studio",
	addresses: [
		"https://studio.local",
		"https://studio.tail.ts.net",
		"https://studio.example.com",
	],
	certificate: null,
	fingerprint: null,
	role: "guest",
	personId: "person-a",
	keyStore: "file",
	createdAt: 0,
	revokedAt: null,
};

const hello = (addresses: string[]): HostHello => ({
	host: { id: "host-a", name: "studio", addresses },
	deviceId: "device-b",
	personId: "person-a",
	spaces: [],
});

const unreachable = () => Promise.reject(new TypeError("Unable to connect."));

/** A Host whose `link` procedures answer by address. */
function fakeHost(answers: Record<string, () => Promise<HostHello>>) {
	const calls: string[] = [];
	const clientFor = (address: string) => {
		const answer = () => {
			calls.push(address);
			return (answers[address] ?? unreachable)();
		};
		return partialHostClient({ link: { hello: answer, heartbeat: answer } });
	};
	return { calls, clientFor };
}

async function until(check: () => boolean, timeoutMs = 2_000) {
	const deadline = now() + timeoutMs;
	while (!check()) {
		if (now() > deadline) throw new Error("Timed out.");
		await Bun.sleep(5);
	}
}

describe("firstAnswering", () => {
	test("tries the addresses in order and keeps the first that answers", async () => {
		const tried: string[] = [];
		const found = await firstAnswering(["a", "b", "c"], async (address) => {
			tried.push(address);
			if (address === "a") throw new TypeError("offline");
			return address.toUpperCase();
		});
		expect(found).toEqual({ address: "b", value: "B" });
		expect(tried).toEqual(["a", "b"]);
	});

	test("a refusal is an answer: it stops there", async () => {
		const tried: string[] = [];
		await expect(
			firstAnswering(["a", "b"], async (address) => {
				tried.push(address);
				throw new ORPCError("UNAUTHORIZED");
			}),
		).rejects.toBeInstanceOf(ORPCError);
		expect(tried).toEqual(["a"]);
	});

	test("none answers: the last error", async () => {
		await expect(
			firstAnswering(["a", "b"], async (address) => {
				throw new Error(`no ${address}`);
			}),
		).rejects.toThrow("no b");
	});
});

describe("httpsLink", () => {
	test("falls through to the tailnet when the LAN name does not answer, and learns the Host's addresses", async () => {
		const host = fakeHost({
			"https://studio.tail.ts.net": async () =>
				hello(["https://studio.tail.ts.net", "https://new.example.com"]),
		});
		const learned: string[][] = [];
		const link = httpsLink({
			link: LINK,
			key: "nsd_key",
			clientFor: host.clientFor,
			heartbeatMs: 10,
			onAddresses: (addresses) => learned.push(addresses),
		});
		try {
			await until(() => link.state().status === "online");
			expect(link.state().address).toBe("https://studio.tail.ts.net");
			expect(host.calls.slice(0, 2)).toEqual([
				"https://studio.local",
				"https://studio.tail.ts.net",
			]);
			// The Host's own list first, then the ones it did not name.
			expect(learned[0]).toEqual([
				"https://studio.tail.ts.net",
				"https://new.example.com",
				"https://studio.local",
				"https://studio.example.com",
			]);
			// Heartbeats go to the address that answered.
			await until(() => host.calls.length >= 4);
			expect(
				host.calls.slice(2).every((a) => a === "https://studio.tail.ts.net"),
			).toBe(true);
		} finally {
			await link.close();
		}
	});

	test("a heartbeat that fails starts over with a backoff, and comes back online", async () => {
		let up = true;
		const host = fakeHost({
			"https://studio.example.com": () =>
				up ? Promise.resolve(hello([])) : unreachable(),
		});
		const states: LinkState["status"][] = [];
		const link = httpsLink({
			link: LINK,
			key: "nsd_key",
			clientFor: host.clientFor,
			heartbeatMs: 5,
			firstBackoffMs: 5,
			onState: (state) => states.push(state.status),
		});
		try {
			await until(() => link.state().status === "online");
			up = false;
			await until(() => link.state().status === "offline");
			up = true;
			await until(() => link.state().status === "online");
			expect(states).toEqual(["online", "offline", "online"]);
		} finally {
			await link.close();
		}
	});

	test("keeps the Host's last answer while online, and none while offline: what its version can do", async () => {
		let up = true;
		let answer: HostHello = hello([]);
		const host = fakeHost({
			"https://studio.example.com": () =>
				up ? Promise.resolve(answer) : unreachable(),
		});
		const link = httpsLink({
			link: LINK,
			key: "nsd_key",
			clientFor: host.clientFor,
			heartbeatMs: 5,
			firstBackoffMs: 5,
		});
		try {
			expect(link.hello()).toBeNull();
			await until(() => link.state().status === "online");
			expect(link.hello()).toEqual(hello([]));
			// The Host was updated: its next answer says more.
			answer = { ...hello([]), stopWaits: true };
			await until(() => link.hello()?.stopWaits === true);
			up = false;
			await until(() => link.state().status === "offline");
			expect(link.hello()).toBeNull();
		} finally {
			await link.close();
		}
	});

	test("a Host that refuses the key ends the link: revoked, and no more calls", async () => {
		let refuse = false;
		const host = fakeHost({
			"https://studio.local": () =>
				refuse
					? Promise.reject(new ORPCError("UNAUTHORIZED"))
					: Promise.resolve(hello([])),
		});
		let revoked = 0;
		const link = httpsLink({
			link: LINK,
			key: "nsd_key",
			clientFor: host.clientFor,
			heartbeatMs: 5,
			onRevoked: () => revoked++,
		});
		await until(() => link.state().status === "online");
		refuse = true;
		await until(() => link.state().status === "revoked");
		const calls = host.calls.length;
		await Bun.sleep(30);
		expect(host.calls.length).toBe(calls);
		expect(revoked).toBe(1);
		expect(link.client()).toBeNull();
		await link.close();
	});

	test("a key the Host knows as another Device's is not used: no calls, no streams, and the key stays", async () => {
		const host = fakeHost({
			"https://studio.local": () => Promise.resolve(hello([])),
		});
		let revoked = 0;
		let streamed = 0;
		const link = httpsLink({
			link: LINK,
			key: "nsd_other_install",
			deviceId: "device-dev",
			clientFor: host.clientFor,
			heartbeatMs: 5,
			onRevoked: () => revoked++,
		});
		link.stream("clones", async () => {
			streamed++;
		});
		await until(() => link.state().status === "revoked");
		const calls = host.calls.length;
		await Bun.sleep(30);
		expect(host.calls.length).toBe(calls);
		expect(link.client()).toBeNull();
		expect(streamed).toBe(0);
		// The key is the other install's: the link does not delete it.
		expect(revoked).toBe(0);
		await expect(link.ready()).rejects.toThrow();
		await link.close();
	});

	test("a stream runs while the link is online, stops when it drops, and starts again when it is back", async () => {
		let up = true;
		const host = fakeHost({
			"https://studio.local": () =>
				up ? Promise.resolve(hello([])) : unreachable(),
		});
		const link = httpsLink({
			link: LINK,
			key: "nsd_key",
			clientFor: host.clientFor,
			heartbeatMs: 5,
			firstBackoffMs: 5,
		});
		const opened: AbortSignal[] = [];
		const stop = link.stream("test", async (_client, signal) => {
			opened.push(signal);
			await new Promise((resolve) =>
				signal.addEventListener("abort", resolve, { once: true }),
			);
		});
		try {
			await until(() => opened.length === 1);
			up = false;
			await until(() => link.state().status === "offline");
			expect(opened[0]?.aborted).toBe(true);
			up = true;
			await until(() => opened.length === 2);
			expect(opened[1]?.aborted).toBe(false);
			stop();
			expect(opened[1]?.aborted).toBe(true);
		} finally {
			await link.close();
		}
	});

	test("a stream that throws starts again after its backoff; one that ran well and returns starts again at once", async () => {
		const host = fakeHost({
			"https://studio.local": async () => hello([]),
		});
		const link = httpsLink({
			link: LINK,
			key: "nsd_key",
			clientFor: host.clientFor,
			heartbeatMs: 20,
			// A wait of 60 to 120 ms: the backoff takes up to half off.
			streamBackoff: { firstMs: 120, maxMs: 120 },
		});
		const failing: number[] = [];
		const returning: number[] = [];
		const errors = console.error;
		console.error = () => {};
		try {
			link.stream("failing", async () => {
				failing.push(now());
				throw new TypeError("Unable to connect.");
			});
			link.stream("returning", async () => {
				returning.push(now());
				await Bun.sleep(25);
			});
			await until(() => failing.length >= 2 && returning.length >= 3);
			expect((failing[1] ?? 0) - (failing[0] ?? 0)).toBeGreaterThanOrEqual(55);
			// Each return ran a heartbeat or more: no wait between them.
			expect((returning[2] ?? 0) - (returning[1] ?? 0)).toBeLessThan(55);
		} finally {
			console.error = errors;
			await link.close();
		}
	});

	test("a stream call the Host refuses makes the link ask the Host now: revoked", async () => {
		let refuse = false;
		const host = fakeHost({
			"https://studio.local": () =>
				refuse
					? Promise.reject(new ORPCError("UNAUTHORIZED"))
					: Promise.resolve(hello([])),
		});
		const link = httpsLink({
			link: LINK,
			key: "nsd_key",
			clientFor: host.clientFor,
			// No heartbeat in this test: only the refusal makes it ask.
			heartbeatMs: 60_000,
		});
		const errors = console.error;
		console.error = () => {};
		try {
			// The owner removes this computer's access while the stream runs.
			link.stream("refused", async (client) => {
				refuse = true;
				await client.link.heartbeat();
			});
			await until(() => link.state().status === "revoked");
			expect(link.client()).toBeNull();
		} finally {
			console.error = errors;
			await link.close();
		}
	});

	describe("hands out the Host's procedures in this computer's words", () => {
		/** A Host whose `sync.addProject` answers as `answer` says now. */
		function hostWith(answer: () => Promise<never>) {
			const clientFor = () =>
				partialHostClient({
					link: {
						hello: async () => hello([]),
						heartbeat: async () => hello([]),
					},
					sync: { addProject: () => answer() },
				});
			return httpsLink({
				link: LINK,
				key: "nsd_key",
				clientFor,
				heartbeatMs: 60_000,
			});
		}
		const add = (client: HostClient) =>
			client.sync.addProject({ spaceId: "s", name: "app", remote: "r" });

		test("a call, a stream and the client itself: an older Host says the caller's words, a refusal keeps the Host's", async () => {
			let answer: () => Promise<never> = () =>
				Promise.reject(new ORPCError("NOT_FOUND"));
			const link = hostWith(() => answer());
			try {
				const client = await link.ready();
				const older = await link
					.call(add, { olderHost: "Update the studio." })
					.catch((error: unknown) => error);
				expect(older).toBeInstanceOf(OlderHostError);
				expect(older).toMatchObject({
					kind: "unavailable",
					message: "Update the studio.",
				});
				await expect(add(client)).rejects.toBeInstanceOf(OlderHostError);
				let seen: unknown;
				const stop = link.stream("test", async (given) => {
					seen = await add(given).catch((error: unknown) => error);
				});
				await until(() => seen !== undefined);
				stop();
				expect(seen).toBeInstanceOf(OlderHostError);

				answer = () =>
					Promise.reject(
						new ORPCError("BAD_REQUEST", {
							message: "Not like this.",
							data: { kind: "invalid" },
						}),
					);
				await expect(link.call(add)).rejects.toMatchObject({
					kind: "invalid",
					message: "Not like this.",
				});
			} finally {
				await link.close();
			}
		});

		test("a call the Host refuses for the key says to pair again, and the link asks the Host now", async () => {
			let refuse = false;
			const host = fakeHost({
				"https://studio.local": () =>
					refuse
						? Promise.reject(new ORPCError("UNAUTHORIZED"))
						: Promise.resolve(hello([])),
			});
			const link = httpsLink({
				link: LINK,
				key: "nsd_key",
				clientFor: host.clientFor,
				heartbeatMs: 60_000,
			});
			try {
				await link.ready();
				refuse = true;
				await expect(
					link.call((client) => client.link.heartbeat()),
				).rejects.toBeInstanceOf(NotPairedError);
				await until(() => link.state().status === "revoked");
			} finally {
				await link.close();
			}
		});
	});

	test("a call rejects at once while the link is offline; ready waits for it, and ends when it closes", async () => {
		let up = false;
		const host = fakeHost({
			"https://studio.local": () =>
				up ? Promise.resolve(hello([])) : unreachable(),
		});
		const link = httpsLink({
			link: LINK,
			key: "nsd_key",
			clientFor: host.clientFor,
			heartbeatMs: 5,
			firstBackoffMs: 5,
			maxBackoffMs: 5,
		});
		await until(() => link.state().status === "offline");
		await expect(link.call(async () => "answered")).rejects.toBeInstanceOf(
			HostUnreachableError,
		);
		const ready = link.ready();
		up = true;
		expect(await ready).toBe(
			link.client() as NonNullable<ReturnType<typeof link.client>>,
		);
		expect(await link.call(async () => "answered")).toBe("answered");

		const stopped = new AbortController();
		up = false;
		await until(() => link.state().status === "offline");
		const waiting = link.ready(stopped.signal);
		stopped.abort();
		await expect(waiting).rejects.toBeDefined();
		const closing = link.ready();
		await link.close();
		await expect(closing).rejects.toThrow("The link to studio is closed.");
	});

	test("documents that do not sync are not in step: the link asks the Host now, and gives up after its time or when it closes", async () => {
		const host = fakeHost({
			"https://studio.local": () => Promise.resolve(hello([])),
		});
		const link = httpsLink({
			link: LINK,
			key: "nsd_key",
			clientFor: host.clientFor,
			heartbeatMs: 60_000,
		});
		await link.ready();
		const asked = host.calls.length;
		expect(await link.inStep([], { timeoutMs: 0 })).toBe(true);
		expect(await link.inStep(["flows:p"], { timeoutMs: 150 })).toBe(false);
		// The heartbeat a minute away came now.
		await until(() => host.calls.length > asked);
		const waiting = link.inStep(["flows:p"], { timeoutMs: 60_000 });
		await link.close();
		expect(await waiting).toBe(false);
	});

	describe("its documents, over the Host's document channel in memory", () => {
		/**
		 * A Host that serves `flows:p` to change, `space:s` to read, and
		 * refuses `device:x`, as its access rules say for this key.
		 */
		function documentHost() {
			const docs = new Map([
				["flows:p", new Y.Doc()],
				["space:s", new Y.Doc()],
				["device:x", new Y.Doc()],
			]);
			const access: Record<string, SyncAccess> = {
				"flows:p": "write",
				"space:s": "read",
			};
			let up = true;
			const watchers = new Set<() => void>();
			const network = {
				up: () => up,
				watch(changed: () => void) {
					watchers.add(changed);
					return () => watchers.delete(changed);
				},
				set(next: boolean) {
					up = next;
					for (const changed of watchers) changed();
				},
			};
			const channel = memoryDocuments(
				{
					document: (name) => docs.get(name) ?? null,
					authorize: ({ documentName, token }) =>
						token === "nsd_key" && (access[documentName] ?? false),
				},
				network,
			);
			const host = fakeHost({
				"https://studio.local": () => Promise.resolve(hello([])),
			});
			/** This Replica's copies, the ones the link gives now. */
			const here = new Map<string, Y.Doc>();
			const link = httpsLink({
				link: LINK,
				key: "nsd_key",
				clientFor: host.clientFor,
				heartbeatMs: 20,
				documentChannel: channel,
				documents: async () => [...here].map(([name, doc]) => ({ name, doc })),
			});
			const on = (name: string) => docs.get(name)?.getMap("m");
			return { link, here, network, on };
		}

		test("a document it may change syncs both ways and is in step", async () => {
			const { link, here, on } = documentHost();
			const flows = new Y.Doc();
			here.set("flows:p", flows);
			on("flows:p")?.set("from", "the Host");
			expect(await link.inStep(["flows:p"])).toBe(true);
			expect(flows.getMap("m").get("from")).toBe("the Host");

			flows.getMap("m").set("saved", "here");
			expect(on("flows:p")?.get("saved")).toBe("here");
			expect(await link.inStep(["flows:p"], { timeoutMs: 0 })).toBe(true);
			await link.close();
		});

		test("a read-only document takes the Host's changes, and its own change keeps it out of step", async () => {
			const { link, here, on } = documentHost();
			const space = new Y.Doc();
			here.set("space:s", space);
			expect(await link.inStep(["space:s"])).toBe(true);
			on("space:s")?.set("project", "shop");
			expect(space.getMap("m").get("project")).toBe("shop");

			space.getMap("m").set("project", "changed here");
			expect(on("space:s")?.get("project")).toBe("shop");
			expect(await link.inStep(["space:s"], { timeoutMs: 100 })).toBe(false);
			await link.close();
		});

		test("a document the Host refuses never syncs and is never in step", async () => {
			const { link, here, on } = documentHost();
			const other = new Y.Doc();
			here.set("device:x", other);
			on("device:x")?.set("secret", "names");
			expect(await link.inStep(["device:x"], { timeoutMs: 100 })).toBe(false);
			expect(other.getMap("m").size).toBe(0);
			await link.close();
		});

		test("while the network is down nothing syncs; when it is back, the edits of both sides merge", async () => {
			const { link, here, network, on } = documentHost();
			const flows = new Y.Doc();
			here.set("flows:p", flows);
			expect(await link.inStep(["flows:p"])).toBe(true);

			network.set(false);
			flows.getMap("m").set("a", "on the Device");
			on("flows:p")?.set("b", "on the Host");
			expect(await link.inStep(["flows:p"], { timeoutMs: 50 })).toBe(false);
			expect(on("flows:p")?.has("a")).toBe(false);

			network.set(true);
			expect(await link.inStep(["flows:p"])).toBe(true);
			expect(flows.getMap("m").toJSON()).toEqual({
				a: "on the Device",
				b: "on the Host",
			});
			expect(on("flows:p")?.get("a")).toBe("on the Device");
			await link.close();
		});

		test("a document the caller no longer gives stops syncing at the next answer of the Host", async () => {
			const { link, here, on } = documentHost();
			const flows = new Y.Doc();
			here.set("flows:p", flows);
			expect(await link.inStep(["flows:p"])).toBe(true);

			here.delete("flows:p");
			await Bun.sleep(100);
			on("flows:p")?.set("later", "on the Host");
			expect(flows.getMap("m").has("later")).toBe(false);
			expect(await link.inStep(["flows:p"], { timeoutMs: 0 })).toBe(false);
			await link.close();
		});
	});
});
