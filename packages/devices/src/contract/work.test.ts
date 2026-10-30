import { describe, expect, test } from "bun:test";
import { type WorkRequest, workDeliverySchema } from "./work";

/**
 * The output schema of the work relay checks every call it carries, whole.
 * `exact<WorkRequest>()` keeps it equal to the type when the code compiles.
 * These calls, one of each kind, check the parts a type cannot: the
 * harness names, the MCP servers, the JSON values.
 */

const forRun = {
	spaceId: "space-1",
	projectId: "project-1",
	personId: "person-1",
	runId: "run-1",
};
const run = {
	id: "run-1",
	projectId: "project-1",
	baseRef: "main",
	author: { name: "Ada", email: "ada@example.com" },
};

const calls: WorkRequest[] = [
	{
		...forRun,
		runId: null,
		call: { kind: "capabilities", query: { programs: ["gh"], profiles: [] } },
	},
	{ ...forRun, runId: null, call: { kind: "flows" } },
	{ ...forRun, call: { kind: "worktree", run } },
	{
		...forRun,
		call: {
			kind: "itemBranch",
			cwd: "/work",
			name: "item-1",
			base: null,
			fallback: "main",
		},
	},
	{
		...forRun,
		call: { kind: "handOff", cwd: "/work", runBranch: "nightshift/run-1" },
	},
	{
		...forRun,
		call: {
			kind: "receiveHandOff",
			run: { id: "run-1", projectId: "project-1" },
			branch: "nightshift/run-1",
			commit: "abc123",
		},
	},
	{ ...forRun, call: { kind: "snapshotWorktree", cwd: "/work" } },
	{
		...forRun,
		call: { kind: "worktreeChanges", cwd: "/work", from: "4b825dc6" },
	},
	{
		...forRun,
		call: {
			kind: "session",
			input: {
				cwd: "/work",
				prompt: "Fix the bug.",
				harness: "acp:goose",
				model: "sonnet",
				permissionMode: "auto",
				effort: "high",
				resumeSessionId: "session-1",
				stepReport: {
					outcomes: [{ name: "pass" }, { name: "fail", description: "No." }],
					output: { type: "object" },
				},
				clis: ["gh"],
				connections: ["linear"],
			},
		},
	},
	{
		...forRun,
		call: {
			kind: "session",
			input: {
				cwd: "/work",
				prompt: "Review it.",
				stepReport: true,
				offered: { profile: "reviewer", permissionMode: "plan" },
			},
		},
	},
	{
		...forRun,
		call: {
			kind: "exec",
			input: {
				command: "bun test",
				cwd: "/work",
				env: { CI: "1" },
				outputFile: true,
			},
		},
	},
	{
		...forRun,
		call: {
			kind: "callTool",
			input: {
				connection: "linear",
				tool: "create_issue",
				arguments: { title: "Bug", labels: ["a"], meta: { n: 1, ok: null } },
			},
		},
	},
	{
		...forRun,
		call: {
			kind: "decide",
			input: {
				decider: "openai",
				prompt: "Is it done?",
				labels: [{ name: "yes" }, { name: "no", description: "Not yet." }],
			},
		},
	},
	{
		...forRun,
		call: {
			kind: "decide",
			input: {
				decider: "ollama",
				prompt: "Name the release.",
				output: { type: "string" },
				model: "llama3",
			},
		},
	},
];

describe("the work relay's output schema", () => {
	test("checks a call of every kind", () => {
		const kinds = new Set(calls.map((request) => request.call.kind));
		expect(kinds.size).toBe(12);
		for (const request of calls) {
			const delivery = { kind: "call", id: "call-1", request };
			expect(workDeliverySchema.safeParse(delivery).error).toBeUndefined();
		}
	});

	test("refuses a call it does not know", () => {
		const request = { ...forRun, call: { kind: "teleport" } };
		const delivery = { kind: "call", id: "call-1", request };
		expect(workDeliverySchema.safeParse(delivery).success).toBe(false);
	});
});
