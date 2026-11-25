import { describe, expect, test } from "bun:test";
import {
	UNREADABLE_REQUEST,
	type WorkCall,
	type WorkReply,
	type WorkRequest,
} from "../../../contract";
import { NO_STARTER } from "../domain/offered-call";
import { admitOfferedCall } from "./admit-offered-call";

const RUN = "abcdef12-0000-0000-0000-000000000000";
const WORKTREE = "/projects/app.nightshift/abcdef12";
const RUN_FOLDER = `/data/run-folders/${RUN}`;
const OWN_FOLDER = "This device works only in the run's own folder.";
const OWN_IDS = "This device works only for the run that asks.";
const NOT_A_RUN = "That is not the id of a run.";
const offer = {
	spaceId: "team",
	deviceId: "self",
	deviceName: "studio",
	profile: "coder",
	profileName: "coder",
	permissionCap: "acceptEdits" as const,
	sessionCap: 1,
	offeredAt: 1,
	by: "ada",
};

/** This computer is Ada's. It offers "coder" to Bob's Space, and notes the calls it serves. */
function setUp(profile: object = {}) {
	const served: WorkRequest[] = [];
	const admission = admitOfferedCall({
		selfOwnerId: async () => "ada",
		device: { id: "self", name: "studio" } as never,
		documents: {
			open: async () => ({ offers: new Map([["self/coder", offer]]) }),
		} as never,
		hostOf: async () => null,
		personInSpace: async () => "ada",
		personOnHost: async () => null,
		memberRole: () => "member",
		roleAllows: () => true,
		projects: {
			find: async (id: string) => ({ id, folder: id !== "no-folder" }),
			clonePath: async () => "/projects/app",
		} as never,
		runFolders: { path: (id: string) => `/data/run-folders/${id}` },
		worktreePath: (repoPath, shortId) => `${repoPath}.nightshift/${shortId}`,
		ownOffers: () => [offer],
		profileFor: () => ({
			harness: "claude-code",
			model: "sonnet",
			permissionMode: "acceptEdits",
			clis: [],
			connections: [],
			...profile,
		}),
		serve: async function* (_device, request) {
			served.push(request);
			yield { kind: "result", value: null };
		},
		remote: () => ({}) as never,
	});
	const ask = async (
		call: WorkCall,
		from: Partial<Omit<WorkRequest, "call">> = {},
	) => {
		const replies: WorkReply[] = [];
		for await (const reply of admission.serve(
			{
				spaceId: "team",
				projectId: "app",
				personId: "bob",
				runId: RUN,
				...from,
				call,
			},
			{ keptHere: true },
			new AbortController().signal,
		)) {
			replies.push(reply);
		}
		const [first] = replies;
		return first?.kind === "error" ? first.message : "served";
	};
	return { ask, served };
}

const session = (extra: object = {}): WorkCall => ({
	kind: "session",
	input: {
		cwd: WORKTREE,
		prompt: "Do the work.",
		offered: { profile: "coder" },
		...extra,
	},
});

const exec = (extra: object = {}): WorkCall => ({
	kind: "exec",
	input: { command: "true", cwd: WORKTREE, ...extra },
});

/** Every call that names a folder, in `cwd`. */
const inFolder = (cwd: string): WorkCall[] => [
	session({ cwd }),
	{ kind: "readFile", input: { cwd, path: "report.md", maxBytes: 10 } },
	{ kind: "itemBranch", cwd, name: "one", base: null, fallback: "main" },
	{ kind: "handOff", cwd, runBranch: "nightshift/abcdef12" },
	{ kind: "snapshotWorktree", cwd },
	{ kind: "worktreeChanges", cwd, from: "tree-1" },
	{ kind: "restoreWorktree", run: { id: RUN, projectId: "app" }, cwd },
];

/** An owner's run over the wire takes a command too. */
const callers = {
	"its owner's run": "ada",
	"another Person's run": "bob",
};

test("a call with no starter is refused", async () => {
	const { ask, served } = setUp();
	expect(await ask(session(), { personId: "" })).toBe(NO_STARTER);
	expect(served).toEqual([]);
});

for (const [name, personId] of Object.entries(callers)) {
	const allIn = (cwd: string) =>
		personId === "ada" ? [...inFolder(cwd), exec({ cwd })] : inFolder(cwd);

	describe(`a call of ${name}`, () => {
		test("works in the folder of its run, and in the folders inside it", async () => {
			for (const cwd of [
				WORKTREE,
				`${WORKTREE}/`,
				`${WORKTREE}/packages/app`,
				`${WORKTREE}/..notes/a..b/...`,
			]) {
				const { ask, served } = setUp();
				const calls = allIn(cwd);
				for (const call of calls) {
					expect([call.kind, cwd, await ask(call, { personId })]).toEqual([
						call.kind,
						cwd,
						"served",
					]);
				}
				expect(served).toHaveLength(calls.length);
			}
		});

		test("works in no other folder", async () => {
			for (const cwd of [
				"/projects/app",
				`${WORKTREE}-other`,
				WORKTREE.toUpperCase(),
				`${WORKTREE.toUpperCase()}/packages`,
				"..",
				"",
				`${WORKTREE}/..`,
				`${WORKTREE}/../other`,
				`${WORKTREE}/a/../../../app`,
				`${WORKTREE}/a/..`,
				`${WORKTREE}//../..`,
			]) {
				const { ask, served } = setUp();
				for (const call of allIn(cwd)) {
					expect([call.kind, cwd, await ask(call, { personId })]).toEqual([
						call.kind,
						cwd,
						OWN_FOLDER,
					]);
				}
				expect(served).toEqual([]);
			}
		});

		test("names its folder as text, for a run that exists", async () => {
			const { ask, served } = setUp();
			for (const cwd of [null, undefined, [WORKTREE]]) {
				for (const call of allIn(cwd as never)) {
					expect([call.kind, await ask(call, { personId })]).toEqual([
						call.kind,
						OWN_FOLDER,
					]);
				}
			}
			expect(await ask(session(), { personId, runId: null })).toBe(OWN_FOLDER);
			expect(served).toEqual([]);
		});

		test("works in the run folder of a project without a folder", async () => {
			const { ask, served } = setUp();
			const from = { personId, projectId: "no-folder" };
			expect(await ask(session({ cwd: `${RUN_FOLDER}/out` }), from)).toBe(
				"served",
			);
			expect(await ask(session({ cwd: `${RUN_FOLDER}/../x` }), from)).toBe(
				OWN_FOLDER,
			);
			expect(served).toHaveLength(1);
		});

		test("names its run by one plain id", async () => {
			const { ask, served } = setUp();
			for (const runId of [
				"../other",
				"abcdef12/../x",
				"a/b",
				"..",
				"abcdef12",
				RUN.toUpperCase(),
				RUN.slice(0, -1),
				`${RUN}0`,
				`x${RUN}`,
				`${RUN}\n`,
				RUN.replaceAll("-", ""),
			]) {
				for (const call of [
					{ kind: "worktree", run: { id: runId, projectId: "app" } },
					{
						kind: "receiveHandOff",
						run: { id: runId, projectId: "app" },
						branch: "b",
						commit: "c",
					},
					{ kind: "decide", input: { decider: "x", prompt: "", labels: [] } },
					session({ cwd: `/projects/app.nightshift/${runId.slice(0, 8)}` }),
				] as WorkCall[]) {
					expect([runId, await ask(call, { personId, runId })]).toEqual([
						runId,
						NOT_A_RUN,
					]);
				}
			}
			expect(served).toEqual([]);
			// A hand-off and the copy of its own run stay.
			for (const call of [
				{ kind: "worktree", run: { id: RUN, projectId: "app" } },
				{
					kind: "receiveHandOff",
					run: { id: RUN, projectId: "app" },
					branch: "b",
					commit: "c",
				},
			] as WorkCall[]) {
				expect(await ask(call, { personId })).toBe("served");
			}
		});

		test("adds a folder for its own run and project", async () => {
			const { ask, served } = setUp();
			for (const run of [
				{ id: "another-run", projectId: "app" },
				// The whole id, not its short form.
				{ id: "abcdef12-0000-0000-0000-000000000001", projectId: "app" },
				{ id: "abcdef12", projectId: "app" },
				{ id: RUN, projectId: "another" },
			]) {
				for (const call of [
					{ kind: "worktree", run },
					{ kind: "runFolder", run },
					{ kind: "receiveHandOff", run, branch: "b", commit: "c" },
					{ kind: "restoreWorktree", run, cwd: WORKTREE },
				] as WorkCall[]) {
					const projectId = call.kind === "runFolder" ? "no-folder" : "app";
					expect([call.kind, await ask(call, { personId, projectId })]).toEqual(
						[
							call.kind,
							"This device adds a folder only for the run that asks.",
						],
					);
				}
			}
			expect(served).toEqual([]);
		});

		test("hands on the branch of its own run", async () => {
			const { ask, served } = setUp();
			const handOff = (runBranch: string): WorkCall => ({
				kind: "handOff",
				cwd: WORKTREE,
				runBranch,
			});
			for (const branch of [
				"main",
				"nightshift/abcdef13",
				"nightshift/abcdef12-1-item",
				`nightshift/${RUN}`,
				"",
				null as never,
				undefined as never,
			]) {
				expect([branch, await ask(handOff(branch), { personId })]).toEqual([
					branch,
					OWN_IDS,
				]);
			}
			expect(served).toEqual([]);
			expect(await ask(handOff("nightshift/abcdef12"), { personId })).toBe(
				"served",
			);
		});

		test("keeps files and reads knowledge for its own run and project", async () => {
			const own = {
				artifacts: { runId: RUN, stepId: "step-1" },
				knowledge: { projectId: "app" },
				knowledgeOnly: { projectId: "app", folders: ["notes"] },
			};
			const others = [
				{ artifacts: { runId: "another-run", stepId: "step-1" } },
				{ artifacts: {} },
				{ knowledge: { projectId: "another" } },
				{ knowledge: {} },
				{ knowledgeOnly: { projectId: "another", folders: ["notes"] } },
				// Beside the own project's.
				{
					knowledge: { projectId: "app" },
					knowledgeOnly: { projectId: "another", folders: [] },
				},
			];
			const { ask, served } = setUp();
			expect(await ask(session(own), { personId })).toBe("served");
			expect(served).toHaveLength(1);
			for (const extra of others) {
				expect([extra, await ask(session(extra), { personId })]).toEqual([
					extra,
					OWN_IDS,
				]);
			}
			expect(served).toHaveLength(1);
		});
	});
}

test("a command of its owner's run keeps files and reads knowledge for its own run and project", async () => {
	const { ask, served } = setUp();
	const personId = "ada";
	const own = {
		artifacts: { runId: RUN, stepId: "step-1" },
		knowledge: { projectId: "app" },
	};
	expect(await ask(exec(own), { personId })).toBe("served");
	for (const extra of [
		{ artifacts: { runId: "another-run", stepId: "step-1" } },
		{ knowledge: { projectId: "another" } },
	]) {
		expect(await ask(exec(extra), { personId })).toBe(OWN_IDS);
	}
	expect(served).toHaveLength(1);
});

test("a session under an Offer runs with its own folder and ids as they came", async () => {
	const { ask, served } = setUp();
	const artifacts = { runId: RUN, stepId: "step-1" };
	await ask(session({ artifacts, knowledge: { projectId: "app" } }));
	expect(served[0]?.call).toMatchObject({
		kind: "session",
		input: { cwd: WORKTREE, artifacts, knowledge: { projectId: "app" } },
	});
});

/** Fields that no call declares, and those of a profile. */
const undeclared = {
	mcpServers: { x: { command: "x" } },
	addDirs: ["/"],
	toolsPath: "/bin",
	harnessConfig: { a: "b" },
	instructions: "x",
	env: { A: "b" },
	tools: [],
	scrubEnv: [],
	readOnly: false,
	another: 1,
};
/** What the Walker decides of a session. */
const step = {
	cwd: WORKTREE,
	prompt: "Do the work.",
	resumeSessionId: "session-1",
	stepReport: { outcomes: [{ name: "done" }] },
	artifacts: { runId: RUN, stepId: "step-1" },
	files: [{ name: "a.txt", mediaType: "text/plain", content: "" }],
	knowledge: { projectId: "app" },
	knowledgeOnly: { projectId: "app", folders: [] },
	maxTurns: 3,
	maxBudgetUsd: 1.5,
};
const inputOf = (request?: WorkRequest) =>
	(request?.call as { input?: unknown } | undefined)?.input;

describe("the input of a call", () => {
	test("under an Offer is the Walker's step and the owner's profile", async () => {
		const { ask, served } = setUp();
		const call = session({
			...step,
			...undeclared,
			harness: "codex",
			model: "another",
			permissionMode: "bypassPermissions",
			effort: "high",
			clis: ["gh"],
			connections: ["github"],
		});
		expect(await ask(call)).toBe("served");
		expect(inputOf(served[0])).toEqual({
			...step,
			underOffer: true,
			harness: "claude-code",
			model: "sonnet",
			permissionMode: "acceptEdits",
		});
	});

	test("under an Offer has no field the Walker left out", async () => {
		const { ask, served } = setUp();
		await ask(session());
		expect(Object.keys(inputOf(served[0]) ?? {}).sort()).toEqual([
			"cwd",
			"harness",
			"model",
			"permissionMode",
			"prompt",
			"underOffer",
		]);
	});

	test("under an Offer keeps what the owner's profile sets", async () => {
		const { ask, served } = setUp({
			effort: "low",
			clis: ["jq"],
			connections: ["linear"],
		});
		await ask(session({ effort: "high", clis: ["gh"], connections: ["x"] }));
		expect(inputOf(served[0])).toMatchObject({
			effort: "low",
			clis: ["jq"],
			connections: ["linear"],
		});
	});

	test("under an Offer runs a mode that is known, within the cap", async () => {
		for (const [asked, runs] of [
			["plan", "plan"],
			["bypassPermissions", "acceptEdits"],
			["another", "acceptEdits"],
		]) {
			const { ask, served } = setUp();
			await ask(
				session({ offered: { profile: "coder", permissionMode: asked } }),
			);
			expect(inputOf(served[0])).toMatchObject({ permissionMode: runs });
		}
	});

	test("of its owner's run is every field the call declares", async () => {
		const part = [{ text: "x" }];
		const declared: [string, object][] = [
			[
				"session",
				{
					...step,
					harness: "codex",
					model: "gpt",
					permissionMode: "auto",
					effort: "high",
					clis: ["gh"],
					connections: ["github"],
					underOffer: true,
				},
			],
			[
				"exec",
				{
					command: "true",
					cwd: WORKTREE,
					env: { A: "b" },
					secrets: ["KEY"],
					outputFile: true,
					knowledge: { projectId: "app" },
					artifacts: { runId: RUN, stepId: "step-1" },
					pid: true,
				},
			],
			["callTool", { connection: "github", tool: "x", arguments: { a: 1 } }],
			[
				"request",
				{
					method: "GET",
					url: part,
					query: [{ name: "q", value: part }],
					headers: [{ name: "h", value: part }],
					body: { kind: "text", contentType: "text/plain", text: part },
					timeoutMs: 1,
					maxBytes: 1,
				},
			],
		];
		for (const [kind, input] of declared) {
			const { ask, served } = setUp();
			const call = { kind, input: { ...undeclared, ...input } } as never;
			expect(await ask(call, { personId: "ada" })).toBe("served");
			expect(inputOf(served[0])).toEqual(input);
		}
	});
});

describe("a session that goes on", () => {
	const onHarness = (harness: string) => ({
		offered: () => ({ ...setUp({ harness }), of: session, by: "bob" }),
		owner: () => ({
			...setUp(),
			of: (extra: object): WorkCall => ({
				kind: "session",
				input: {
					cwd: WORKTREE,
					prompt: "Go on.",
					harness: harness as "codex",
					model: "m",
					permissionMode: "plan",
					...extra,
				},
			}),
			by: "ada",
		}),
	});
	const NO_SESSION = "That is not the id of a session.";

	for (const who of ["offered", "owner"] as const) {
		test(`names the session by its id (${who})`, async () => {
			for (const [harness, id, outcome] of [
				["claude-code", "0f8fad5b-d9cb-469f-a165-70867728950e", "served"],
				["opencode", "ses_1-a", "served"],
				["claude-code", undefined, "served"],
				["claude-code", "-p", NO_SESSION],
				["codex", "--json", NO_SESSION],
				["claude-code", ["a"], NO_SESSION],
				["claude-code", null, NO_SESSION],
				["acp:goose", "-V1StGXR8", "served"],
				["acp:goose", { a: 1 }, NO_SESSION],
			] as const) {
				const { ask, served, of, by } = onHarness(harness)[who]();
				const call = of({ resumeSessionId: id });
				expect([harness, id, await ask(call, { personId: by })]).toEqual([
					harness,
					id,
					outcome,
				]);
				expect(served).toHaveLength(outcome === "served" ? 1 : 0);
			}
		});

		test(`has limits that are numbers (${who})`, async () => {
			for (const limit of [
				{ maxTurns: "3" },
				{ maxBudgetUsd: "1" },
				{ maxTurns: null },
			]) {
				const { ask, of, by } = onHarness("claude-code")[who]();
				expect(await ask(of(limit), { personId: by })).toBe(UNREADABLE_REQUEST);
			}
		});
	}
});
