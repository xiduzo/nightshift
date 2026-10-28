import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	canonicalFlowJson,
	type Flow,
	flowSchema,
	singleAgentFlow,
} from "@nightshift/flows";

import {
	type Daemon,
	SERVER_DIR,
	startDaemon,
	stopDaemon,
} from "./test-daemons";

/**
 * `nightshift flows` end to end: the command runs in a project's folder
 * and reads and saves that project's flows in Night Shift on this computer.
 */

const root = mkdtempSync(join(tmpdir(), "nightshift-flows-cli-"));
let daemon: Daemon;
let folder: string;

const flow = singleAgentFlow({
	prompt: "Fix the issue",
	model: "sonnet",
	permissionMode: "acceptEdits",
});

/** The flow as Night Shift gives it back: parsed, as canonical JSON. */
const asSaved = (saved: Flow) => canonicalFlowJson(flowSchema.parse(saved));

async function nightshift(
	args: string[],
	stdin?: string,
): Promise<{ code: number; out: string; err: string }> {
	const child = Bun.spawn(
		[
			"bun",
			join(SERVER_DIR, "src/cli.ts"),
			"flows",
			...args,
			"--daemon",
			daemon.url,
		],
		{
			cwd: folder,
			stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, out, err };
}

beforeAll(async () => {
	daemon = await startDaemon(root, "daemon", {});
	folder = join(root, "project");
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, "README.md"), "# project\n");
	for (const args of [
		["init", "-q", "-b", "main"],
		["add", "README.md"],
		[
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@nightshift.invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-q",
			"-m",
			"initial",
		],
	]) {
		Bun.spawnSync(["git", ...args], { cwd: folder });
	}
	await daemon.client.projects.add({ repoPath: folder });
}, 60_000);

afterAll(async () => {
	await stopDaemon(daemon);
	rmSync(root, { recursive: true, force: true });
});

describe("nightshift flows", () => {
	test("saves a flow from a file and gets it back as JSON", async () => {
		const file = join(root, "fix.json");
		writeFileSync(file, JSON.stringify(flow));
		const saved = await nightshift(["save", "fix", file]);
		expect(saved).toMatchObject({ code: 0, out: "fix\n" });

		const got = await nightshift(["get", "fix"]);
		expect(got.code).toBe(0);
		expect(got.out).toBe(asSaved(flow));

		const list = await nightshift(["list"]);
		expect(list.out).toBe("fix\t1 steps\t0 errors\t\n");
	});

	test("saves a flow from stdin, as a new revision", async () => {
		const changed = { ...flow, description: "Fixes it" };
		const saved = await nightshift(["save", "fix"], JSON.stringify(changed));
		expect(saved.code).toBe(0);

		const revisions = await nightshift(["revisions", "fix"]);
		const lines = revisions.out.trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toEndWith("\tcurrent");
		const [newest, oldest] = lines.map((line) => line.split("\t")[0]);
		expect((await nightshift(["revision", "fix", oldest as string])).out).toBe(
			asSaved(flow),
		);
		expect((await nightshift(["revision", "fix", newest as string])).out).toBe(
			asSaved(changed),
		);
	});

	test("refuses a file that is not a flow, and saves nothing", async () => {
		const notJson = await nightshift(["save", "broken"], "{ nope");
		expect(notJson.code).toBe(1);
		expect(notJson.err).toContain("The input is not valid JSON");

		const notAFlow = await nightshift(["save", "broken"], '{"nodes": 3}');
		expect(notAFlow.code).toBe(1);
		expect(notAFlow.err).toContain("The input is not a valid flow.");
		expect((await nightshift(["list"])).out).not.toContain("broken");
	});

	test("exports a flow to a folder and imports it under a free name", async () => {
		const exports = join(root, "exports");
		mkdirSync(exports);
		const exported = await nightshift(["export", "fix", "--out", exports]);
		expect(exported.code).toBe(0);
		const file = exported.out.trim();
		expect(file).toBe(join(exports, "fix.json"));

		const imported = await nightshift(["import", file]);
		expect(imported).toMatchObject({ code: 0, out: "fix-2\n" });
		expect((await nightshift(["get", "fix-2"])).out).toBe(
			readFileSync(file, "utf8"),
		);
	});

	test("says what is wrong with an unknown project or flow", async () => {
		const project = await nightshift(["list", "--project", "nope"]);
		expect(project.code).toBe(1);
		expect(project.err).toContain('Night Shift has no project "nope".');

		const missing = await nightshift(["get", "nope"]);
		expect(missing.code).toBe(1);
		expect(missing.err).toContain('"nope"');
	});
});
