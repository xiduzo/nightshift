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
	test("keeps the files of an answer as artifacts of the Gate, and gives them back for a session", async () => {
		const store = createArtifactStore(join(root, "data"));
		const b64 = (text: string) => Buffer.from(text).toString("base64");
		const kept = await store.saveAnswer({
			runId: "r1",
			stepId: "gate-step-1",
			files: [
				{ name: "spec.md", mediaType: "", content: b64("# Spec") },
				{ name: "shot.png", mediaType: "image/png", content: b64("png") },
			],
		});
		expect(kept.map((a) => [a.name, a.mediaType, a.size, a.from])).toEqual([
			["spec.md", "text/markdown", 6, "answer"],
			["shot.png", "image/png", 3, "answer"],
		]);
		// An agent's own artifact is not an answer's file.
		await store.save({
			runId: "r1",
			stepId: "s2",
			cwd: worktree,
			path: "shots/login.png",
		});
		await store.saveAnswer({
			runId: "r1",
			stepId: "gate-step-2",
			files: [{ name: "spec.md", mediaType: "", content: b64("# Two") }],
		});
		const files = await store.answerFiles("r1");
		expect(files.map((f) => f.name)).toEqual([
			"spec.md",
			"shot.png",
			"gate-ste-spec.md",
		]);
		const { dir, paths } = await store.answerFolder("r1", files);
		expect(dir).toBe(join(root, "data", "artifacts", "r1", "answers"));
		expect(await readFile(paths[0] ?? "", "utf8")).toBe("# Spec");
		expect(await readFile(paths[2] ?? "", "utf8")).toBe("# Two");
	});
});
