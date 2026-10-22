import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Artifact, createArtifactStore } from "@nightshift/engine";

import { artifactFileResponse, parseRange } from "./artifact-file";

describe("parseRange", () => {
	test("reads one bytes range, both ends inclusive", () => {
		expect(parseRange(null, 10)).toBeNull();
		expect(parseRange("bytes=0-3", 10)).toEqual({ start: 0, end: 3 });
		expect(parseRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 });
		expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
		expect(parseRange("bytes=5-99", 10)).toEqual({ start: 5, end: 9 });
	});

	test("several ranges: the whole file; a range past the end: invalid", () => {
		expect(parseRange("bytes=0-1,4-5", 10)).toBeNull();
		expect(parseRange("bytes=10-", 10)).toBe("invalid");
		expect(parseRange("bytes=5-2", 10)).toBe("invalid");
		expect(parseRange("bytes=-", 10)).toBe("invalid");
	});
});

describe("artifactFileResponse", () => {
	let root: string;
	let kept: Artifact;
	let space: Parameters<typeof artifactFileResponse>[0];
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "nightshift-artifact-file-"));
		await Bun.write(join(root, "page.html"), "<script>alert(1)</script>");
		const store = createArtifactStore(join(root, "data"));
		kept = await store.save({
			runId: "r1",
			stepId: "s1",
			cwd: root,
			path: "page.html",
		});
		space = {
			artifactFile: (runId, id) =>
				runId === "r1"
					? store.file(runId, id)
					: Promise.reject(new Error(`Run not found: ${runId}`)),
		};
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const get = (path: string, headers?: Record<string, string>) =>
		new Request(`http://localhost${path}`, { headers });

	test("serves the file inline, never as a page that runs scripts", async () => {
		const response = await artifactFileResponse(space, get("/"), "r1", kept.id);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toStartWith("text/html");
		expect(response.headers.get("content-security-policy")).toBe("sandbox");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("content-disposition")).toStartWith("inline");
		expect(await response.text()).toBe("<script>alert(1)</script>");
	});

	test("?download: an attachment; a range: that part", async () => {
		const download = await artifactFileResponse(
			space,
			get("/?download"),
			"r1",
			kept.id,
		);
		expect(download.headers.get("content-disposition")).toBe(
			"attachment; filename*=UTF-8''page.html",
		);
		const part = await artifactFileResponse(
			space,
			get("/", { range: "bytes=0-7" }),
			"r1",
			kept.id,
		);
		expect(part.status).toBe(206);
		expect(part.headers.get("content-range")).toBe("bytes 0-7/25");
		expect(await part.text()).toBe("<script>");
	});

	test("an unknown artifact, or a run of another Space: not found", async () => {
		expect(
			(await artifactFileResponse(space, get("/"), "r1", "nope")).status,
		).toBe(404);
		expect(
			(await artifactFileResponse(space, get("/"), "r2", kept.id)).status,
		).toBe(404);
	});
});
