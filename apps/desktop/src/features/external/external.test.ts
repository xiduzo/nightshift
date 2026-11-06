import { describe, expect, test } from "bun:test";

import { downloadScript, externalUrl } from "./external";

describe("links that leave the window", () => {
	test("web and mail links open outside the app", () => {
		for (const url of [
			"https://github.com/xiduzo/nightshift",
			"http://localhost:4300/api/runs/1/artifacts/2",
			"mailto:someone@example.com",
		]) {
			expect(externalUrl({ url, isCmdClick: true })).toBe(url);
		}
	});

	test("the app's own pages, files and other programs stay closed", () => {
		for (const url of [
			"views://mainview/inbox",
			"file:///etc/passwd",
			"slack://open",
			"javascript:alert(1)",
			"not a url",
		]) {
			expect(externalUrl({ url })).toBeNull();
		}
	});

	test("a detail that did not parse opens nothing", () => {
		expect(externalUrl('{"url":"https://a.example/"b"}')).toBeNull();
		expect(externalUrl(null)).toBeNull();
	});
});

describe("downloads the page hears about", () => {
	/** The event a script dispatches. */
	function dispatched(script: string | null) {
		const json = script?.match(/detail:(.*)}\)\);$/)?.[1];
		return json ? JSON.parse(json) : null;
	}

	test("name the file as it is on disk", () => {
		const script = downloadScript("completed", {
			filename: "demo (1).mp4",
			path: "/Users/me/Downloads/demo (1).mp4",
		});
		expect(script).toStartWith(
			'window.dispatchEvent(new CustomEvent("nightshift:download"',
		);
		expect(dispatched(script)).toEqual({
			state: "completed",
			id: "/Users/me/Downloads/demo (1).mp4",
			name: "demo (1).mp4",
		});
	});

	test("a failed download has only its path", () => {
		expect(
			dispatched(
				downloadScript("failed", {
					filename: "",
					path: "/Users/me/Downloads/a.png",
					error: "Download canceled",
				}),
			),
		).toEqual({
			state: "failed",
			id: "/Users/me/Downloads/a.png",
			name: "a.png",
		});
	});

	test("a name stays inside the script's string", () => {
		const script = downloadScript("started", {
			path: '/d/a"b\\c.png',
		});
		expect(dispatched(script)?.name).toBe('a"b\\c.png');
	});

	test("an event without a file tells nothing", () => {
		expect(downloadScript("started", {})).toBeNull();
		expect(downloadScript("failed", "not json")).toBeNull();
	});
});
