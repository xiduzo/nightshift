import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunFolders } from "@nightshift/engine";
import { Hono } from "hono";

import { runFileResponse } from "./run-file";

describe("GET /api/runs/:id/files/<path>", () => {
	let root: string;
	let space: Parameters<typeof runFileResponse>[0];
	/** The route as the daemon has it: the run's Space is checked before. */
	let app: Hono;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "nightshift-run-file-"));
		const folders = createRunFolders(join(root, "data"));
		const { path } = await folders.make("r1");
		await writeFile(join(path, "page.html"), "<script>alert(1)</script>");
		await mkdir(join(path, "report notes"));
		await writeFile(join(path, "report notes", "été.md"), "# Summary\n");
		await writeFile(join(root, "secret.txt"), "secret\n");
		await symlink(join(root, "secret.txt"), join(path, "secret.txt"));
		space = {
			runFile: (runId, file) =>
				runId === "r1"
					? folders.file(runId, file)
					: Promise.reject(new Error(`Run not found: ${runId}`)),
		};
		app = new Hono();
		app.get("/api/runs/:id/files/*", (c) =>
			runFileResponse(space, c.req.raw, c.req.param("id")),
		);
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const get = (path: string, headers?: Record<string, string>) =>
		app.request(`http://localhost${path}`, { headers });

	test("serves the file inline, never as a page that runs scripts", async () => {
		const response = await get("/api/runs/r1/files/page.html");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toStartWith("text/html");
		expect(response.headers.get("content-security-policy")).toBe("sandbox");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("content-disposition")).toStartWith("inline");
		expect(response.headers.get("cache-control")).toBe("private, no-cache");
		expect(await response.text()).toBe("<script>alert(1)</script>");
	});

	test("a file in a folder, with each part of its path encoded", async () => {
		const response = await get(
			`/api/runs/r1/files/${encodeURIComponent("report notes")}/${encodeURIComponent("été.md")}?download`,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-disposition")).toBe(
			`attachment; filename*=UTF-8''${encodeURIComponent("été.md")}`,
		);
		expect(await response.text()).toBe("# Summary\n");
	});

	test("a range: that part", async () => {
		const part = await get("/api/runs/r1/files/page.html", {
			range: "bytes=0-7",
		});
		expect(part.status).toBe(206);
		expect(part.headers.get("content-range")).toBe("bytes 0-7/25");
		expect(await part.text()).toBe("<script>");
		const past = await get("/api/runs/r1/files/page.html", {
			range: "bytes=99-",
		});
		expect(past.status).toBe(416);
	});

	test("a path out of the folder, a link, a folder, or a run of another Space: not found", async () => {
		for (const path of [
			"/api/runs/r1/files/secret.txt",
			"/api/runs/r1/files/..%2F..%2Fsecret.txt",
			"/api/runs/r1/files/%2E%2E/%2E%2E/secret.txt",
			"/api/runs/r1/files/report%20notes",
			"/api/runs/r1/files/gone.md",
			"/api/runs/r1/files/%E0%A4%A",
			"/api/runs/r1/files/",
			"/api/runs/r2/files/page.html",
		]) {
			const response = await get(path);
			expect({ path, status: response.status }).toEqual({ path, status: 404 });
		}
	});
});
