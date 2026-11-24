import { describe, expect, test } from "bun:test";
import {
	hostDeviceName,
	isContainerId,
	selfDeviceHost,
} from "./self-device-host";

describe("selfDeviceHost", () => {
	const of = (
		hostName: string,
		container: boolean,
		env: Record<string, string> = {},
	) => selfDeviceHost({ env, hostName, container, platform: "linux" });

	test("NIGHTSHIFT_DEVICE_NAME wins over the host name", () => {
		const host = of("cea79743b08a", true, {
			NIGHTSHIFT_DEVICE_NAME: " Office Host ",
		});
		expect(host.name).toBe("Office Host");
		expect(host.stale?.("cea79743b08a")).toBe(true);
		expect(host.stale?.("Office Host")).toBe(false);
	});

	test("a container named by its id takes the name of its Host address", () => {
		const host = of("cea79743b08a", true, {
			NIGHTSHIFT_HOST_ADDRESSES: "not a url, https://ns.example.com:8443",
		});
		expect(host.name).toBe("ns.example.com");
		expect(host.stale?.("Host")).toBe(true);
		expect(host.stale?.("cea79743b08a")).toBe(true);
	});

	test("a container named by its id without an address is a Host", () => {
		expect(of("cea79743b08a", true).name).toBe("Host");
		expect(of("nightshift", true).name).toBe("nightshift");
	});

	test("outside a container, Host is a chosen name", () => {
		expect(of("Adas-MacBook", false).stale?.("Host")).toBe(false);
	});

	test("outside a container the host name stays, hex or not", () => {
		const host = of("cea79743b08a", false);
		expect(host.name).toBe("cea79743b08a");
		expect(host.stale?.("deadbeef0000")).toBe(false);
		expect(of("Adas-MacBook.local", false).name).toBe("Adas-MacBook");
	});

	test("a new dev Device is named apart from the desktop app's", () => {
		const host = selfDeviceHost({
			env: {},
			hostName: "LE2316.local",
			container: false,
			platform: "darwin",
			dev: true,
		});
		expect(host.name).toBe("LE2316 (dev)");
		// A dev Device that still has the host name takes the new name (ADR 17).
		expect(host.stale?.("LE2316")).toBe(true);
		const named = selfDeviceHost({
			env: { NIGHTSHIFT_DEVICE_NAME: "Studio" },
			hostName: "LE2316",
			container: false,
			platform: "darwin",
			dev: true,
		});
		expect(named.name).toBe("Studio");
	});

	test("the host name drops the .local of macOS", () => {
		expect(hostDeviceName("Adas-MacBook.local")).toBe("Adas-MacBook");
		expect(hostDeviceName("hetzner-1")).toBe("hetzner-1");
	});

	test("a container id is a 12 or 64 hex host name", () => {
		expect(isContainerId("cea79743b08a")).toBe(true);
		expect(isContainerId("a".repeat(64))).toBe(true);
		expect(isContainerId("hetzner-1")).toBe(false);
		expect(isContainerId("CEA79743B08A")).toBe(false);
	});
});
