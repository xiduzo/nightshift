import { describe, expect, test } from "bun:test";
import type { AgentSetupJob, AgentSetupView } from "@/shared/api";
import {
	actionLabel,
	agentSummary,
	installProgress,
	justReady,
	pickAgent,
	setupOffer,
	setupRuns,
	setupStep,
	signInAccount,
} from "./setup-state";

const agent = (
	fields: Partial<AgentSetupView> = {},
	job: AgentSetupJob = { state: "idle" },
): AgentSetupView => ({
	harness: "claude-code",
	label: "Claude Code",
	vendor: "Anthropic",
	path: null,
	install: {
		command: "curl -fsSL https://claude.ai/install.sh | bash",
		source: "https://claude.ai/install.sh",
	},
	signIn: { command: "claude auth login" },
	job,
	...fields,
});

const codex = (job: AgentSetupJob = { state: "idle" }) =>
	agent({ harness: "codex", label: "Codex", vendor: "OpenAI" }, job);

describe("the step of a setup", () => {
	test("a missing agent offers the install, one that is here the sign-in", () => {
		expect(setupStep(agent())).toEqual({
			kind: "choose",
			action: "install",
			note: null,
		});
		expect(setupStep(agent({ path: "/u/.local/bin/claude" }))).toEqual({
			kind: "choose",
			action: "sign-in",
			note: null,
		});
	});

	test("a cancelled setup goes back to the choice, without a note", () => {
		expect(setupStep(agent({}, { state: "cancelled", at: 1 }))).toEqual({
			kind: "choose",
			action: "install",
			note: null,
		});
	});

	test("an install that ended offers the sign-in", () => {
		const step = setupStep(
			agent(
				{ path: "/u/.local/bin/claude" },
				{ state: "installed", path: "/u/.local/bin/claude", at: 1 },
			),
		);
		expect(step).toEqual({
			kind: "choose",
			action: "sign-in",
			note: {
				tone: "done",
				text: "Claude Code is installed. Sign in to use it.",
			},
		});
	});

	test("a failed install keeps the installer messages, an empty one none", () => {
		const failed = (output: string) =>
			setupStep(
				agent(
					{},
					{ state: "install-failed", problem: "It failed.", output, at: 1 },
				),
			);
		expect(failed("curl: (6) no host")).toEqual({
			kind: "choose",
			action: "install",
			note: {
				tone: "problem",
				text: "It failed.",
				output: "curl: (6) no host",
			},
		});
		expect(failed("  \n")).toMatchObject({
			note: { tone: "problem", output: null },
		});
	});

	test("a failed sign-in shows its problem and offers the sign-in again", () => {
		expect(
			setupStep(
				agent(
					{ path: "/bin/claude" },
					{ state: "sign-in-failed", problem: "Not signed in yet.", at: 1 },
				),
			),
		).toEqual({
			kind: "choose",
			action: "sign-in",
			note: { tone: "problem", text: "Not signed in yet.", output: null },
		});
	});

	test("an agent that is ready says so, and can be signed in again", () => {
		expect(
			setupStep(
				agent(
					{ path: "/bin/claude" },
					{
						state: "ready",
						profileId: "p1",
						profileName: "builder",
						account: null,
						at: 1,
					},
				),
			),
		).toEqual({
			kind: "choose",
			action: "sign-in",
			note: {
				tone: "done",
				text: "Claude Code is ready. It answers for the Builder and the Improver.",
			},
		});
	});

	test("the running jobs show their progress", () => {
		expect(setupStep(agent({}, { state: "installing", since: 5 }))).toEqual({
			kind: "installing",
			since: 5,
		});
		expect(setupStep(agent({}, { state: "checking", since: 5 }))).toEqual({
			kind: "checking",
		});
		expect(
			setupStep(agent({}, { state: "signing-in", url: null, since: 5 })),
		).toEqual({ kind: "browser", url: null, codeNeeded: false });
		expect(
			setupStep(
				agent(
					{},
					{ state: "code-needed", url: "https://claude.ai/oauth", since: 5 },
				),
			),
		).toEqual({
			kind: "browser",
			url: "https://claude.ai/oauth",
			codeNeeded: true,
		});
	});
});

describe("a job that runs", () => {
	test("installing, checking and the sign-in run, the rest do not", () => {
		const runs: AgentSetupJob[] = [
			{ state: "installing", since: 1 },
			{ state: "checking", since: 1 },
			{ state: "signing-in", url: null, since: 1 },
			{ state: "code-needed", url: null, since: 1 },
		];
		const ended: AgentSetupJob[] = [
			{ state: "idle" },
			{ state: "installed", path: "/bin/claude", at: 1 },
			{ state: "install-failed", problem: "x", output: "", at: 1 },
			{ state: "sign-in-failed", problem: "x", at: 1 },
			{
				state: "ready",
				profileId: "p1",
				profileName: "builder",
				account: null,
				at: 1,
			},
			{ state: "cancelled", at: 1 },
		];
		expect(runs.map(setupRuns)).toEqual([true, true, true, true]);
		expect(ended.map(setupRuns)).toEqual(ended.map(() => false));
	});

	test("a setup is just ready only after it ran", () => {
		const ready: AgentSetupJob = {
			state: "ready",
			profileId: "p1",
			profileName: "builder",
			account: "ada@example.com",
			at: 9,
		};
		expect(justReady({ state: "checking", since: 1 }, ready)).toEqual(ready);
		expect(
			justReady({ state: "code-needed", url: null, since: 1 }, ready),
		).toBe(ready);
		// The screen saw it ready from the start: no toast, nothing opens.
		expect(justReady(undefined, ready)).toBeNull();
		expect(justReady(ready, ready)).toBeNull();
		expect(
			justReady(
				{ state: "checking", since: 1 },
				{ state: "sign-in-failed", problem: "x", at: 2 },
			),
		).toBeNull();
	});
});

describe("the agent the dialog opens on", () => {
	test("the one asked for, else one that runs, else the recommended one", () => {
		const claude = agent();
		const installing = codex({ state: "installing", since: 1 });
		expect(pickAgent([claude, codex()], "codex")?.harness).toBe("codex");
		expect(pickAgent([claude, installing])?.harness).toBe("codex");
		expect(pickAgent([codex(), claude])?.harness).toBe("claude-code");
		expect(pickAgent([codex()])?.harness).toBe("codex");
		expect(pickAgent([])).toBeUndefined();
	});

	test("an agent asked for that setup does not know falls back", () => {
		expect(pickAgent([codex(), agent()], "pi")?.harness).toBe("claude-code");
	});
});

describe("the words of a setup", () => {
	test("each agent signs in with its vendor's account", () => {
		expect(signInAccount(agent())).toBe("Claude");
		expect(signInAccount(codex())).toBe("ChatGPT");
		expect(signInAccount({ harness: "pi", label: "pi" })).toBe("pi");
	});

	test("the main button installs, signs in, or adds a signed-in agent", () => {
		expect(actionLabel(agent(), "install", false)).toBe("Install Claude Code");
		expect(actionLabel(agent(), "sign-in", false)).toBe("Sign in to Claude");
		expect(actionLabel(codex(), "sign-in", false)).toBe("Sign in to ChatGPT");
		expect(actionLabel(agent(), "sign-in", true)).toBe("Add Claude Code");
	});

	test("a card says who makes the agent and whether it is here", () => {
		expect(agentSummary(agent())).toBe("Anthropic · Not installed");
		expect(agentSummary(codex())).toBe("OpenAI · Not installed");
		expect(agentSummary(agent({ path: "/bin/claude" }))).toBe(
			"Anthropic · Installed",
		);
	});
});

describe("the bar of an install", () => {
	test("it moves fast at first, then slower, and stays under 90 %", () => {
		expect(installProgress(1_000, 1_000)).toBe(0);
		expect(installProgress(1_000, 500)).toBe(0);
		const half = installProgress(0, 30_000);
		const minute = installProgress(0, 60_000);
		expect(half).toBeGreaterThan(50);
		expect(minute).toBeGreaterThan(half);
		expect(installProgress(0, 3_600_000)).toBe(90);
	});
});

describe("what an agent's panel offers", () => {
	const check = (
		path: string | null,
		signIn: "signed_in" | "signed_out" | "unknown",
	) => ({
		path,
		signIn,
	});

	test("install a missing agent, sign in one that is signed out", () => {
		expect(setupOffer(agent(), check(null, "unknown"))).toBe("install");
		expect(setupOffer(agent(), check("/bin/claude", "signed_out"))).toBe(
			"sign-in",
		);
	});

	test("nothing for a ready agent, an unknown sign-in, or before the check", () => {
		expect(setupOffer(agent(), check("/bin/claude", "signed_in"))).toBeNull();
		expect(setupOffer(agent(), check("/bin/claude", "unknown"))).toBeNull();
		expect(setupOffer(agent(), undefined)).toBeNull();
	});

	test("nothing for an agent Night Shift cannot set up", () => {
		expect(setupOffer(undefined, check(null, "unknown"))).toBeNull();
	});

	test("a setup that runs shows, whatever the check says", () => {
		expect(
			setupOffer(
				agent({}, { state: "installing", since: 1 }),
				check(null, "unknown"),
			),
		).toBe("running");
		expect(
			setupOffer(agent({}, { state: "checking", since: 1 }), undefined),
		).toBe("running");
	});
});
