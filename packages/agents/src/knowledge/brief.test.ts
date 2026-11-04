/**
 * What an agent is told about the knowledge, on every harness: its real
 * text, through the harness's real session, to a fake program that logs what
 * it got. Read the snapshot next to this file to see it. A copy change shows
 * up there, on purpose: every Agent step on every harness reads this text.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ACP_AGENTS,
	acpAgentHarness,
	acpHarness,
} from "../harnesses/acp/harness";
import { claudeCodeHarness } from "../harnesses/claude-code/harness";
import { codexHarness } from "../harnesses/codex/harness";
import { grokBuildHarness } from "../harnesses/grok-build/harness";
import { opencodeHarness } from "../harnesses/opencode/harness";
import {
	type AgentHarness,
	type AgentSessionInput,
	foldContributions,
	type PermissionMode,
} from "../port";
import { reportInputSchema, reportRules } from "../session/step-report";
import { fakeBin } from "../testing/fixtures/bin";
import {
	KNOWLEDGE_INDEX_INTRO,
	KNOWLEDGE_TERMINAL_INSTRUCTION,
	knowledgeBrief,
	knowledgeEnv,
	LEARNINGS_RULE,
} from "./brief";
import { knowledgeTools } from "./tools";

const FOLDER = "/data/knowledge/p1";

let dir: string;
let cwd: string;
let log: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-brief-"));
	cwd = await mkdtemp(join(tmpdir(), "nightshift-brief-cwd-"));
	log = join(dir, "told.jsonl");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
	await rm(cwd, { recursive: true, force: true });
});

const tools = () =>
	knowledgeTools(
		{ searchKnowledge: async () => [], readKnowledge: async () => null },
		{ project: { id: "p1" } },
	);

/** A step of a run with its knowledge on, as the local Device starts it. */
function session(
	permissionMode: PermissionMode,
	model: string,
): AgentSessionInput {
	return {
		cwd,
		model,
		permissionMode,
		signal: new AbortController().signal,
		...foldContributions({ prompt: "Run the tests", stepReport: true }, [
			knowledgeBrief({ folder: FOLDER, tools: tools(), learnings: true }),
		]),
	};
}

/** What a harness's agent got: only what it is told. */
type Told = {
	/** The system prompt, for a harness that takes one apart from the prompt. */
	system?: string;
	prompt: string;
	/** The tools it may call. */
	tools: string[];
	/** How it may read the folder: by a flag, by a rule, or it reads any folder. */
	folder: unknown;
};

async function drain(harness: AgentHarness, input: AgentSessionInput) {
	for await (const _ of harness.run(input)) {
		// The fake program logs what it got.
	}
}

async function logLines(): Promise<Record<string, unknown>[]> {
	const text = await readFile(log, "utf8");
	return text
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

const flag = (argv: string[], name: string) =>
	argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;

const names = (tools: unknown) =>
	((tools ?? []) as { name: string }[]).map((tool) => tool.name);

async function toldClaudeCode(mode: PermissionMode): Promise<Told> {
	const claude = await fakeBin(dir, "claude", "fake-claude", {
		FAKE_CLAUDE_LOG: log,
	});
	await drain(
		claudeCodeHarness({ claudeExecutable: claude }),
		session(mode, "haiku"),
	);
	const [run] = await logLines();
	const argv = run?.argv as string[];
	const system = flag(argv, "--append-system-prompt");
	return {
		...(system ? { system } : {}),
		prompt: run?.prompt as string,
		tools: names(run?.tools),
		folder: { "--add-dir": flag(argv, "--add-dir") ?? null },
	};
}

async function toldCodex(mode: PermissionMode): Promise<Told> {
	const codex = await fakeBin(dir, "codex", "fake-codex", {
		FAKE_CODEX_LOG: log,
	});
	await drain(
		codexHarness({ codexExecutable: codex }),
		session(mode, "gpt-5.3-codex"),
	);
	const [run] = await logLines();
	return {
		prompt: run?.prompt as string,
		tools: names(run?.tools),
		folder: { "--add-dir": flag(run?.argv as string[], "--add-dir") ?? null },
	};
}

async function toldOpencode(mode: PermissionMode): Promise<Told> {
	const opencode = await fakeBin(dir, "opencode", "fake-opencode", {
		FAKE_OPENCODE_LOG: log,
	});
	await drain(
		opencodeHarness({ opencodeExecutable: opencode }),
		session(mode, "ollama/qwen3:8b"),
	);
	const [run] = await logLines();
	const config = run?.config as {
		permission: { external_directory: unknown };
	};
	return {
		prompt: run?.prompt as string,
		tools: names(run?.tools),
		folder: config.permission.external_directory,
	};
}

async function toldGrokBuild(mode: PermissionMode): Promise<Told> {
	const grok = await fakeBin(dir, "grok", "fake-grok", { FAKE_GROK_LOG: log });
	await drain(
		grokBuildHarness({ grokExecutable: grok }),
		session(mode, "grok-build"),
	);
	const [run] = await logLines();
	return {
		prompt: flag(run?.argv as string[], "-p") as string,
		tools: [],
		folder: "reads any folder",
	};
}

/** An ACP agent's log: one line per thing it got. */
async function toldAcp(): Promise<Told> {
	const lines = await logLines();
	const of = (type: string) => lines.find((line) => line.type === type);
	return {
		prompt: of("prompt")?.text as string,
		tools: (of("tools")?.names as string[] | undefined) ?? [],
		folder: "reads any folder",
	};
}

async function toldCopilot(mode: PermissionMode): Promise<Told> {
	const executable = await fakeBin(dir, "copilot", "fake-acp", {
		FAKE_ACP_LOG: log,
	});
	await drain(acpHarness("copilot", { executable }), session(mode, "gpt-5"));
	return toldAcp();
}

async function toldPi(mode: PermissionMode): Promise<Told> {
	const executable = await fakeBin(dir, "pi", "fake-acp", {
		FAKE_ACP_LOG: log,
		FAKE_ACP_CONFIG: "options",
	});
	// The real pi, but for how it starts: pi-acp would run the real program.
	const { launch: _, ...pi } = ACP_AGENTS.pi;
	await drain(
		acpAgentHarness("pi", pi, { executable }),
		session(mode, "default"),
	);
	return toldAcp();
}

describe("what an agent is told about the knowledge", () => {
	for (const [name, told] of [
		["Claude Code", toldClaudeCode],
		["Codex", toldCodex],
		["OpenCode", toldOpencode],
		["Grok Build", toldGrokBuild],
		["an ACP agent (Copilot)", toldCopilot],
		["pi", toldPi],
	] as const) {
		for (const mode of ["auto", "plan"] as const) {
			test(`${name}, ${mode} mode`, async () => {
				expect(await told(mode)).toMatchSnapshot();
			});
		}
	}

	test("the tools and the report field, as a harness offers them", () => {
		expect({
			env: knowledgeEnv(FOLDER),
			indexIntro: KNOWLEDGE_INDEX_INTRO,
			terminal: KNOWLEDGE_TERMINAL_INSTRUCTION,
			tools: tools().map(({ name, description, inputSchema }) => ({
				name,
				description,
				inputSchema,
			})),
			report: reportInputSchema(
				reportRules({ learnings: true }) as NonNullable<
					ReturnType<typeof reportRules>
				>,
			),
		}).toMatchSnapshot();
	});
});

describe("docs/knowledge.md", () => {
	/** A quote as a sentence: without its `>`, its line breaks and its code marks. */
	const plain = (text: string) =>
		text.replace(/\n> /g, " ").replaceAll("`", "");

	test("quotes the brief word for word", async () => {
		const docs = plain(
			await readFile(
				join(import.meta.dir, "../../../../docs/knowledge.md"),
				"utf8",
			),
		);
		const { instructions, toolsInstruction } = knowledgeBrief({
			folder: "<folder>",
			tools: [],
			learnings: true,
		});
		expect(docs).toContain(plain(instructions));
		expect(docs).toContain(plain(toolsInstruction));
		expect(docs).toContain(plain(LEARNINGS_RULE));
	});
});
