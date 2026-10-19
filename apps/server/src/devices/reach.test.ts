import { describe, expect, test } from "bun:test";

import { LISTEN_HOSTNAME, reachFor } from "./index";
import { hostOrigin } from "./join";

describe("secure by default", () => {
	test("a daemon answers this computer only, until it is a Host with an https:// address", () => {
		expect(reachFor({ host: false, hostAddresses: [] })).toBe("this-computer");
		expect(
			reachFor({ host: false, hostAddresses: ["https://studio.example.com"] }),
		).toBe("this-computer");
		expect(
			reachFor({ host: true, hostAddresses: ["http://localhost:3000"] }),
		).toBe("this-computer");
		expect(
			reachFor({
				host: true,
				hostAddresses: ["http://localhost:3000", "https://studio.local"],
			}),
		).toBe("network");
		expect(LISTEN_HOSTNAME["this-computer"]).toBe("127.0.0.1");
	});

	test("join addresses are https://, or http:// on this computer", () => {
		expect(hostOrigin("https://studio.example.com/devices")).toBe(
			"https://studio.example.com",
		);
		expect(hostOrigin("studio.example.com")).toBe("https://studio.example.com");
		expect(hostOrigin("http://localhost:3000")).toBe("http://localhost:3000");
		expect(hostOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
		expect(() => hostOrigin("http://studio.example.com")).toThrow(/https:\/\//);
		expect(() => hostOrigin("http://192.168.1.20:3000")).toThrow(/https:\/\//);
	});
});
