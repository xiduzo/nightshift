import { describe, expect, test } from "bun:test";
import { LaptopIcon, MonitorIcon, ServerIcon } from "lucide-react";
import { deviceIcon } from "./device-icon";

const computer = (platform: string, host = false) => ({
	platform,
	host: { enabled: host },
});

describe("deviceIcon", () => {
	test("a Host or a Linux computer is a server", () => {
		expect(deviceIcon(computer("darwin", true))).toBe(ServerIcon);
		expect(deviceIcon(computer("linux"))).toBe(ServerIcon);
	});

	test("a Mac or a Windows computer is a laptop", () => {
		expect(deviceIcon(computer("darwin"))).toBe(LaptopIcon);
		expect(deviceIcon(computer("win32"))).toBe(LaptopIcon);
	});

	test("an unknown computer is a monitor", () => {
		expect(deviceIcon(null)).toBe(MonitorIcon);
		expect(deviceIcon(computer("freebsd"))).toBe(MonitorIcon);
	});
});
