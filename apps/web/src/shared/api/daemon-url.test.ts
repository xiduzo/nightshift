import { describe, expect, test } from "bun:test";

import { serverUrlFor } from "./daemon-url";

describe("the Night Shift the UI calls", () => {
	test("the one that served the page, at the address the browser used", () => {
		expect(
			serverUrlFor("http://localhost:3000", {
				origin: "https://studio.tail1234.ts.net",
				servedByDaemon: true,
			}),
		).toBe("https://studio.tail1234.ts.net");
	});

	test("in the desktop window, the daemon the app started", () => {
		expect(
			serverUrlFor("http://localhost:3000", {
				origin: "views://mainview",
				servedByDaemon: false,
				desktopDaemonUrl: "http://localhost:4300",
			}),
		).toBe("http://localhost:4300");
	});

	test("else the address the UI was built for", () => {
		expect(
			serverUrlFor("http://localhost:3000/", {
				origin: "http://localhost:3001",
				servedByDaemon: false,
			}),
		).toBe("http://localhost:3000");
		expect(serverUrlFor("http://localhost:3000", null)).toBe(
			"http://localhost:3000",
		);
	});
});
