import { afterEach, expect, mock, test } from "bun:test";
import { hostVersionWords } from "@nightshift/refusal";
import { ORPCError } from "@orpc/client";
import type { HostClient } from "../contract";
import type { HostLink, HostLinks } from "./host-links";
import { createDeviceLinks } from "./links";

/**
 * A development install stays off every Host but this computer's (ADR 20):
 * a link it saved earlier does not start, and the daemon still starts.
 */

const link = (addresses: string[]): HostLink =>
	({
		hostId: "host-a",
		name: "Studio",
		addresses,
		certificate: null,
		fingerprint: null,
		role: "home",
		personId: "person",
		keyStore: "file",
		createdAt: 0,
		revokedAt: null,
	}) as HostLink;

const warnings = mock(() => {});
const warn = console.warn;
afterEach(() => {
	console.warn = warn;
	warnings.mockClear();
});

async function started(saved: HostLink, localOnly: boolean) {
	console.warn = warnings;
	const links = createDeviceLinks({
		links: { list: async () => [saved] } as unknown as HostLinks,
		keys: {
			kind: "file",
			get: async () => "device-key",
			set: async () => {},
			delete: async () => {},
		},
		localOnly,
		linkOptions: { heartbeatMs: 60_000 },
	});
	await links.start();
	const running = links.get("host-a") !== undefined;
	await links.close();
	return running;
}

test("a link to a Host on another computer does not start, with a warning", async () => {
	expect(await started(link(["https://studio.example.com"]), true)).toBe(false);
	expect(warnings).toHaveBeenCalledTimes(1);
});

test("a link to a Host on this computer starts", async () => {
	expect(await started(link(["http://127.0.0.1:1"]), true)).toBe(true);
	expect(warnings).not.toHaveBeenCalled();
});

test("with the person's allowance, a link to a Host on another computer starts", async () => {
	expect(await started(link(["https://studio.invalid"]), false)).toBe(true);
	expect(warnings).not.toHaveBeenCalled();
});

test("a Host that refuses the key: what follows goes on when one step of it fails", async () => {
	const error = console.error;
	const lines = mock(() => {});
	console.error = lines;
	const marked: string[] = [];
	const gone = Promise.withResolvers<void>();
	const deleted = Promise.withResolvers<void>();
	const links = createDeviceLinks({
		links: {
			list: async () => [link(["https://studio.invalid"])],
			revoked: async (hostId: string) => {
				marked.push(hostId);
			},
		} as unknown as HostLinks,
		keys: {
			kind: "file",
			get: async () => "device-key",
			set: async () => {},
			delete: async () => {
				deleted.resolve();
				throw new Error("locked");
			},
		},
		revoked: async () => gone.resolve(),
		hostClient: () =>
			({
				link: {
					hello: async () => {
						throw new ORPCError("UNAUTHORIZED", {
							data: { hostId: "host-a" },
						});
					},
				},
			}) as unknown as HostClient,
		linkOptions: { heartbeatMs: 20, firstBackoffMs: 5, maxBackoffMs: 20 },
	});
	try {
		await links.start();
		await Promise.all([gone.promise, deleted.promise]);
		await new Promise((resolve) => setTimeout(resolve, 5));
	} finally {
		console.error = error;
		await links.close();
	}
	expect(marked).toEqual(["host-a"]);
	expect(lines).toHaveBeenCalledTimes(1);
});

test("a Host of another version: the key, the access and the link stay, and the page says what to update", async () => {
	console.warn = warnings;
	const lost: string[] = [];
	const links = createDeviceLinks({
		links: {
			list: async () => [link(["https://studio.invalid"])],
			revoked: async () => lost.push("marked"),
		} as unknown as HostLinks,
		keys: {
			kind: "file",
			get: async () => "device-key",
			set: async () => {},
			delete: async () => {
				lost.push("key");
			},
		},
		revoked: async () => {
			lost.push("left");
		},
		hostClient: () =>
			({
				link: {
					hello: async () => {
						throw new ORPCError("HOST_UNREACHABLE", {
							status: 503,
							data: { device: "older", hostId: "host-a" },
						});
					},
				},
			}) as unknown as HostClient,
		linkOptions: { heartbeatMs: 20, firstBackoffMs: 5, maxBackoffMs: 5 },
	});
	try {
		await links.start();
		while (links.get("host-a")?.state().status !== "outdated") {
			await Bun.sleep(5);
		}
		// Many asks later, the same.
		await Bun.sleep(50);
		expect(await links.hosts()).toMatchObject([
			{
				hostId: "host-a",
				homeHost: true,
				status: "outdated",
				update: hostVersionWords("newer"),
			},
		]);
	} finally {
		await links.close();
	}
	expect(lost).toEqual([]);
	expect(warnings).toHaveBeenCalledTimes(1);
});
