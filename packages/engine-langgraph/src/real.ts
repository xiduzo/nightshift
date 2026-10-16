/**
 * SPIKE. One real Claude Code session through the LangGraph runner, in a
 * throwaway git repo: agent (haiku) → command. Run with `bun run src/real.ts`.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { claudeCodeHarness } from "@nightshift/agents";
import { flowSchema } from "@nightshift/flows";

import { createRunner } from "./run";

const cwd = await mkdtemp(join(tmpdir(), "lg-real-"));
await writeFile(join(cwd, "README.md"), "# Spike\n");
Bun.spawnSync(["git", "init", "-q"], { cwd });
Bun.spawnSync(["git", "add", "."], { cwd });
Bun.spawnSync(
	[
		"git",
		"-c",
		"user.name=spike",
		"-c",
		"user.email=spike@example.com",
		"commit",
		"-qm",
		"init",
	],
	{ cwd },
);

const flow = flowSchema.parse({
	version: 2,
	start: "worker",
	nodes: [
		{
			id: "worker",
			type: "agent",
			position: { x: 0, y: 0 },
			prompt:
				"Create a file named hello.txt containing the single word hello. Then report the step as pass with the summary 'wrote hello.txt'.",
			harness: "claude-code",
			model: "haiku",
			permissionMode: "acceptEdits",
		},
		{
			id: "check",
			type: "command",
			position: { x: 0, y: 0 },
			command: 'cat hello.txt && echo "summary was: {{worker.summary}}"',
		},
	],
	edges: [{ id: "e1", from: "worker", outcome: "pass", to: "check" }],
});

const client = createClient({ url: `file:${join(cwd, "runs.db")}` });
const runner = createRunner({
	client,
	services: {
		harnesses: { "claude-code": claudeCodeHarness({}) },
		flows: {},
		cwd,
	},
});

const started = Date.now();
for await (const item of runner.start("real-1", flow)) {
	if (item.kind === "event" && item.event.type === "agent") {
		const e = item.event.event;
		if (e.type === "text") process.stdout.write(e.delta);
		else console.log(`\n[${e.type}]`, JSON.stringify(e).slice(0, 160));
	} else if (item.kind === "event") {
		console.log(
			`\n== ${item.event.type} ${item.event.nodeId}`,
			"outcome" in item.event ? item.event.outcome : "",
		);
	}
}
const state = await runner.state("real-1", flow);
console.log("\nENDED", JSON.stringify(state.values.ended));
console.log("WORKER", JSON.stringify(state.values.nodes.worker));
console.log("CHECK", JSON.stringify(state.values.nodes.check));
console.log(
	"CHECKPOINTS",
	(await runner.history("real-1", flow)).length,
	"in",
	Date.now() - started,
	"ms",
);
console.log("REPO", cwd);
