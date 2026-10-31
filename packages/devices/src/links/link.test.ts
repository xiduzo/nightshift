import { describe, expect, test } from "bun:test";
import { HostUnreachableError } from "@nightshift/engine";
import { ORPCError } from "@orpc/client";
import type { HostHello } from "../contract";
import { partialHostClient } from "../testing";
import type { HostLink } from "./host-links";
import { firstAnswering, httpsLink, type LinkState } from "./link";

/** The Link's own logic, over fake Hosts: no network. */

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
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("Timed out.");
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
				failing.push(Date.now());
				throw new TypeError("Unable to connect.");
			});
			link.stream("returning", async () => {
				returning.push(Date.now());
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
			link.stream("refused", async () => {
				refuse = true;
				throw new ORPCError("UNAUTHORIZED");
			});
			await until(() => link.state().status === "revoked");
			expect(link.client()).toBeNull();
		} finally {
			console.error = errors;
			await link.close();
		}
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
});
