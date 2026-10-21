import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";
import type { HostClient } from "./host-client";
import type { HostLink } from "./host-links";
import { firstAnswering, httpsLink, type LinkState } from "./link";
import type { HostHello } from "./types";

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
		return {
			link: { hello: answer, heartbeat: answer },
		} as unknown as HostClient;
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
});
