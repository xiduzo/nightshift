import { afterEach, expect, mock, test } from "bun:test";
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
