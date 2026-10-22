import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createArtifactStore } from "./store";

let root: string;
let worktree: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "nightshift-artifacts-"));
	worktree = join(root, "worktree");
	await Bun.write(join(worktree, "shots", "login.png"), "png bytes");
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("artifact store", () => {
	test("keeps a copy of a file relative to the worktree, and lists it", async () => {
		const store = createArtifactStore(join(root, "data"));
		const kept = await store.save({
			runId: "r1",
			stepId: "s1",
			cwd: worktree,
			path: "shots/login.png",
			title: "Login page",
		});
		expect(kept).toMatchObject({
			stepId: "s1",
			name: "login.png",
			title: "Login page",
			mediaType: "image/png",
			size: 9,
		});
		// The agent may change its own file afterwards: the copy stays.
		await writeFile(join(worktree, "shots", "login.png"), "changed");
		const found = await store.file("r1", kept.id);
		expect(found?.artifact).toEqual(kept);
		expect(await readFile(found?.path ?? "", "utf8")).toBe("png bytes");
		expect(await store.list("r1")).toEqual([kept]);
		expect(await store.list("r2")).toEqual([]);
		expect(await store.file("r1", "nope")).toBeNull();
	});

	test("an absolute path works; the title defaults to the file name", async () => {
		const store = createArtifactStore(join(root, "data"));
		const kept = await store.save({
			runId: "r1",
			stepId: "s1",
			cwd: "/elsewhere",
			path: join(worktree, "shots", "login.png"),
		});
		expect(kept.title).toBe("login.png");
	});

	test("refuses a missing file or a folder, with words for the agent", async () => {
		const store = createArtifactStore(join(root, "data"));
		const save = (path: string) =>
			store.save({ runId: "r1", stepId: "s1", cwd: worktree, path });
		await expect(save("missing.png")).rejects.toThrow("No file at missing.png");
		await expect(save("shots")).rejects.toThrow("No file at shots");
		expect(await store.list("r1")).toEqual([]);
	});

	test("skips a torn line of the index", async () => {
		const data = join(root, "data");
		const store = createArtifactStore(data);
		const kept = await store.save({
			runId: "r1",
			stepId: "s1",
			cwd: worktree,
			path: "shots/login.png",
		});
		await appendFile(join(data, "artifacts", "r1", "index.ndjson"), '{"id":');
		expect(await store.list("r1")).toEqual([kept]);
	});
});
