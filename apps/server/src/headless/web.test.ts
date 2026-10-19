import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DAEMON_META, directoryWeb, type WebFiles, webHandler } from "./web";

const PAGE =
	"<!DOCTYPE html><html><head><title>Night Shift</title></head></html>";

function files(paths: Record<string, string>): WebFiles {
	return {
		file: (path) =>
			paths[path] === undefined
				? null
				: new Blob([paths[path]], {
						type: path.endsWith(".js") ? "text/javascript" : "",
					}),
	};
}

const ui = webHandler(
	files({
		"/index.html": PAGE.replace("Night Shift", "home"),
		"/devices/index.html": PAGE.replace("Night Shift", "devices"),
		"/assets/app-1234.js": "console.log(1)",
	}),
);

const get = (path: string, accept = "text/html") =>
	ui(new Request(`http://localhost:3000${path}`, { headers: { accept } }));

describe("the web UI the daemon serves", () => {
	test("a page, marked as served by Night Shift", async () => {
		const response = await get("/devices");
		expect(response?.headers.get("content-type")).toContain("text/html");
		const html = await response?.text();
		expect(html).toContain("<title>devices</title>");
		expect(html).toContain(`<head>${DAEMON_META}`);
	});

	test("a route without a page of its own gets the app, which routes in the browser", async () => {
		expect(await (await get("/runs/abc"))?.text()).toContain(
			"<title>home</title>",
		);
	});

	test("assets, cached for good", async () => {
		const response = await get("/assets/app-1234.js", "*/*");
		expect(await response?.text()).toBe("console.log(1)");
		expect(response?.headers.get("cache-control")).toContain("immutable");
		expect(await get("/assets/missing.js", "*/*")).toBeNull();
	});

	test("the daemon keeps its own paths, and / for a probe", async () => {
		expect(await get("/", "*/*")).toBeNull();
		expect(await (await get("/"))?.text()).toContain("<title>home</title>");
		for (const path of ["/rpc/healthCheck", "/api/auth/session", "/sync"]) {
			expect(await get(path)).toBeNull();
		}
		expect(
			await ui(
				new Request("http://localhost:3000/devices", {
					method: "POST",
					headers: { accept: "text/html" },
				}),
			),
		).toBeNull();
	});

	test("a folder never serves a file outside it", async () => {
		const root = mkdtempSync(join(tmpdir(), "nightshift-web-"));
		mkdirSync(join(root, "client"));
		writeFileSync(join(root, "client", "index.html"), PAGE);
		writeFileSync(join(root, "secret.txt"), "no");
		const web = directoryWeb(join(root, "client"));
		expect(web.file("/index.html")).not.toBeNull();
		expect(web.file("/../secret.txt")).toBeNull();
		expect(web.file("/missing")).toBeNull();
		const handler = webHandler(web);
		expect(
			await handler(new Request("http://localhost/%2e%2e/secret.txt")),
		).toBeNull();
	});
});
