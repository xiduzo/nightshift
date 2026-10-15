import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	deleteFlowFile,
	flowsDir,
	listFlowFiles,
	readFlowFile,
	writeFlowFile,
} from "./files";
import { singleAgentFlow } from "./quick";
import type { Flow } from "./schema";

let repo: string;

beforeEach(async () => {
	repo = await mkdtemp(join(tmpdir(), "nightshift-flows-"));
});

afterEach(async () => {
	await rm(repo, { recursive: true, force: true });
});

const quick = (): Flow => ({
	...singleAgentFlow({
		prompt: "Fix it",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
	description: "A quick fix",
});

const unbounded = (): Flow => ({
	...quick(),
	edges: [{ id: "again", from: "agent", outcome: "fail", to: "agent" }],
});

describe("flowsDir", () => {
	test("is .nightshift/flows under the repo", () => {
		expect(flowsDir("/repo")).toBe(join("/repo", ".nightshift", "flows"));
	});
});

describe("writeFlowFile", () => {
	test("creates the directory and writes pretty JSON with a newline", async () => {
		const flow = quick();
		const issues = await writeFlowFile(repo, "quick-fix", flow);
		expect(issues).toEqual([]);
		const text = await readFile(
			join(repo, ".nightshift", "flows", "quick-fix.json"),
			"utf8",
		);
		expect(text).toBe(`${JSON.stringify(flow, null, "\t")}\n`);
	});

	test("saves drafts with errors and returns the issues", async () => {
		const issues = await writeFlowFile(repo, "draft", unbounded());
		expect(issues).toEqual([
			expect.objectContaining({ severity: "error", nodeId: "agent" }),
		]);
		expect((await readFlowFile(repo, "draft")).flow).toEqual(unbounded());
	});

	test("overwrites an existing file", async () => {
		await writeFlowFile(repo, "quick-fix", quick());
		await writeFlowFile(repo, "quick-fix", { ...quick(), description: "v2" });
		expect((await readFlowFile(repo, "quick-fix")).flow?.description).toBe(
			"v2",
		);
	});
});

describe("readFlowFile", () => {
	test("round-trips a written flow", async () => {
		await writeFlowFile(repo, "quick-fix", quick());
		expect(await readFlowFile(repo, "quick-fix")).toEqual({
			name: "quick-fix",
			path: join(flowsDir(repo), "quick-fix.json"),
			flow: quick(),
			issues: [],
		});
	});

	test("throws a clear error when the file is missing", async () => {
		await expect(readFlowFile(repo, "missing")).rejects.toThrow(
			/Flow "missing" not found/,
		);
	});

	test("invalid JSON loads with flow null and one issue", async () => {
		await mkdir(flowsDir(repo), { recursive: true });
		await writeFile(join(flowsDir(repo), "broken.json"), "{ nope");
		const loaded = await readFlowFile(repo, "broken");
		expect(loaded.flow).toBeNull();
		expect(loaded.issues).toEqual([
			{ severity: "error", message: expect.stringContaining("Not valid JSON") },
		]);
	});

	test("a schema mismatch loads with flow null and schema issues", async () => {
		await mkdir(flowsDir(repo), { recursive: true });
		await writeFile(
			join(flowsDir(repo), "wrong.json"),
			JSON.stringify({ version: 2, start: "a", nodes: [], edges: [] }),
		);
		const loaded = await readFlowFile(repo, "wrong");
		expect(loaded.flow).toBeNull();
		expect(loaded.issues[0]?.message).toStartWith("version: ");
	});
});

describe("listFlowFiles", () => {
	test("a missing directory is an empty list", async () => {
		expect(await listFlowFiles(repo)).toEqual([]);
	});

	test("lists json files sorted by name, counting errors", async () => {
		await writeFlowFile(repo, "zeta", quick());
		await writeFlowFile(repo, "alpha", unbounded());
		await writeFile(join(flowsDir(repo), "broken.json"), "not json");
		await writeFile(join(flowsDir(repo), "notes.txt"), "ignore me");
		const dir = flowsDir(repo);
		expect(await listFlowFiles(repo)).toEqual([
			{
				name: "alpha",
				path: join(dir, "alpha.json"),
				description: "A quick fix",
				nodeCount: 1,
				errorCount: 1,
			},
			{
				name: "broken",
				path: join(dir, "broken.json"),
				description: null,
				nodeCount: null,
				errorCount: 1,
			},
			{
				name: "zeta",
				path: join(dir, "zeta.json"),
				description: "A quick fix",
				nodeCount: 1,
				errorCount: 0,
			},
		]);
	});
});

describe("deleteFlowFile", () => {
	test("removes the file", async () => {
		await writeFlowFile(repo, "quick-fix", quick());
		await deleteFlowFile(repo, "quick-fix");
		expect(await listFlowFiles(repo)).toEqual([]);
	});

	test("throws when the file is missing", async () => {
		await expect(deleteFlowFile(repo, "missing")).rejects.toThrow(
			/Flow "missing" not found/,
		);
	});
});

describe("flow names", () => {
	const bad = ["../escape", "a/b", "Upper", "", "-dash", "x.json", ".hidden"];

	for (const name of bad) {
		test(`rejects ${JSON.stringify(name)} in every function`, async () => {
			await expect(readFlowFile(repo, name)).rejects.toThrow(
				/Invalid flow name/,
			);
			await expect(writeFlowFile(repo, name, quick())).rejects.toThrow(
				/Invalid flow name/,
			);
			await expect(deleteFlowFile(repo, name)).rejects.toThrow(
				/Invalid flow name/,
			);
		});
	}

	test("a rejected write creates nothing", async () => {
		await expect(writeFlowFile(repo, "../escape", quick())).rejects.toThrow();
		expect(await listFlowFiles(repo)).toEqual([]);
	});
});
