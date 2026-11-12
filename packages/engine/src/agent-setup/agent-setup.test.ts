import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessName } from "@nightshift/flows";
import { isAgentProfile } from "@nightshift/flows";

import {
	type ConfigStores,
	openConfigStores,
} from "../device-config/config-stores";
import type { SecretBackend } from "../device-config/connections";
import { createSandbox, type Sandbox, waitFor } from "../testing/test-support";
import {
	type AgentSetup,
	type AgentSetupDeps,
	type AgentSetupJob,
	createAgentSetup,
	type SignInCheck,
} from "./agent-setup";
import { type FakeProcess, fakeSpawn } from "./test-support";

/**
 * The guided setup with a fake spawn, a fake check and a temp home folder:
 * no test runs a real installer or a real sign-in.
 */

let sandbox: Sandbox;
let home: string;
let stores: ConfigStores;
let setup: AgentSetup | null = null;
beforeEach(async () => {
	sandbox = await createSandbox();
	home = await mkdtemp(join(tmpdir(), "nightshift-agent-setup-"));
	const noSecrets: SecretBackend = {
		get: async () => null,
		set: async () => {},
		delete: async () => {},
	};
	stores = await openConfigStores({
		document: await sandbox.openDocument(),
		env: {},
		secrets: noSecrets,
	});
});
afterEach(async () => {
	setup?.stop();
	setup = null;
	await sandbox.cleanup();
	await rm(home, { recursive: true, force: true });
});

const HERE = { here: true };
const ADA = "ada@example.com";

/** A computer with these programs on its PATH. */
function computer(programs: Record<string, string>) {
	return (program: string) => programs[program] ?? null;
}

/** The answers of the sign-in check, in turn. The last one repeats. */
function checks(...answers: SignInCheck["signIn"][]) {
	const asked: string[] = [];
	return {
		asked,
		check: async (harness: HarnessName, bin: string): Promise<SignInCheck> => {
			asked.push(`${harness} ${bin}`);
			const signIn = answers.length > 1 ? answers.shift() : answers[0];
			return {
				signIn: signIn ?? "unknown",
				account: signIn === "signed_in" ? ADA : null,
			};
		},
	};
}

function make(
	deps: Partial<AgentSetupDeps> & { spawn: AgentSetupDeps["spawn"] },
) {
	setup = createAgentSetup({
		stores,
		check: checks("signed_out").check,
		container: false,
		platform: "darwin",
		home,
		env: { PATH: "/usr/bin", HOME: home },
		which: computer({ curl: "/usr/bin/curl" }),
		...deps,
	});
	return setup;
}

const jobOf = (s: AgentSetup, harness: HarnessName): AgentSetupJob => {
	const agent = s.status(HERE).agents.find((a) => a.harness === harness);
	if (!agent) throw new Error(`No setup for ${harness}.`);
	return agent.job;
};

const until = (s: AgentSetup, harness: HarnessName, state: string) =>
	waitFor(() => jobOf(s, harness).state === state && jobOf(s, harness), {
		label: `${harness} ${state}`,
	});

/** What the vendor's installer does: puts the CLI in ~/.local/bin. */
async function installs(name: string) {
	const bin = join(home, ".local/bin");
	await mkdir(bin, { recursive: true });
	await writeFile(join(bin, name), "#!/bin/sh\n");
	await chmod(join(bin, name), 0o755);
	return join(bin, name);
}

describe("the status of the guided setup", () => {
	test("lists Claude Code and Codex with what will run, on this computer", () => {
		const { spawn } = fakeSpawn();
		const status = make({ spawn }).status(HERE);
		expect(status).toMatchObject({
			available: true,
			reason: null,
			message: null,
		});
		expect(status.agents).toEqual([
			{
				harness: "claude-code",
				label: "Claude Code",
				vendor: "Anthropic",
				path: null,
				install: {
					command: "curl -fsSL https://claude.ai/install.sh | bash",
					source: "https://claude.ai/install.sh",
				},
				signIn: { command: "claude auth login" },
				job: { state: "idle" },
			},
			{
				harness: "codex",
				label: "Codex",
				vendor: "OpenAI",
				path: null,
				install: {
					command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
					source: "https://chatgpt.com/codex/install.sh",
				},
				signIn: { command: "codex login" },
				job: { state: "idle" },
			},
		]);
	});

	test("is not available for a request from elsewhere, in a container, or on Windows", () => {
		const { spawn } = fakeSpawn();
		expect(make({ spawn }).status({ here: false })).toMatchObject({
			available: false,
			reason: "elsewhere",
			message: "Open Night Shift on that computer to set up an agent there.",
		});
		expect(make({ spawn, container: true }).status(HERE)).toMatchObject({
			available: false,
			reason: "container",
		});
		expect(make({ spawn, platform: "win32" }).status(HERE)).toMatchObject({
			available: false,
			reason: "platform",
			message: "Night Shift can set up an agent on macOS and Linux only.",
		});
	});
});

describe("installing an agent CLI", () => {
	test("runs the vendor's installer, then finds the CLI and puts its folder on the PATH", async () => {
		const env: Record<string, string | undefined> = {
			PATH: "/usr/bin",
			HOME: home,
		};
		const { spawn, started } = fakeSpawn(async (proc) => {
			await installs("claude");
			proc.exit(0);
		});
		const s = make({ spawn, env });
		const view = s.install("claude-code", HERE);
		expect(view.job.state).toBe("installing");
		expect(started[0]?.argv).toEqual([
			"/bin/sh",
			"-c",
			"curl -fsSL https://claude.ai/install.sh | bash",
		]);
		const job = await until(s, "claude-code", "installed");
		expect(job).toMatchObject({ path: join(home, ".local/bin/claude") });
		expect(env.PATH).toBe(`${join(home, ".local/bin")}:/usr/bin`);
	});

	test("a failed install says so, with the end of its output", async () => {
		const { spawn } = fakeSpawn((proc) => {
			proc.print("curl: (6) Could not resolve host: claude.ai\n");
			proc.exit(6);
		});
		const s = make({ spawn });
		s.install("claude-code", HERE);
		expect(await until(s, "claude-code", "install-failed")).toMatchObject({
			problem:
				"Night Shift could not install Claude Code. Try again, or read the details.",
			output: "curl: (6) Could not resolve host: claude.ai",
		});
	});

	test("an installer that ends well but leaves no CLI is a failed install", async () => {
		const { spawn } = fakeSpawn((proc) => proc.exit(0));
		const s = make({ spawn });
		s.install("codex", HERE);
		expect(await until(s, "codex", "install-failed")).toMatchObject({
			problem:
				"Codex installed, but Night Shift cannot find it. Restart Night Shift, then try again.",
		});
	});

	test("a timeout stops it", async () => {
		const { spawn, started } = fakeSpawn();
		const s = make({ spawn, installTimeoutMs: 20 });
		s.install("codex", HERE);
		expect(await until(s, "codex", "install-failed")).toMatchObject({
			problem:
				"The install of Codex took too long. Night Shift stopped it. Try again.",
		});
		expect(started[0]?.stopped).toBe(true);
	});

	test("is refused from elsewhere, in a container, for pi, twice at once, and without curl", () => {
		const { spawn, started } = fakeSpawn();
		expect(() =>
			make({ spawn }).install("claude-code", { here: false }),
		).toThrow("Open Night Shift on that computer to set up an agent there.");
		expect(() =>
			make({ spawn, container: true }).install("claude-code", HERE),
		).toThrow("Night Shift runs in a container here");
		const s = make({ spawn });
		expect(() => s.install("pi", HERE)).toThrow(
			"Night Shift cannot install pi for you. Install it yourself, then add it.",
		);
		s.install("claude-code", HERE);
		expect(() => s.install("claude-code", HERE)).toThrow(
			"Night Shift is setting up Claude Code already. Wait for it, or cancel it.",
		);
		expect(() =>
			make({ spawn, which: computer({}) }).install("codex", HERE),
		).toThrow("Night Shift needs curl to download Codex.");
		expect(started).toHaveLength(1);
	});
});

describe("signing an agent CLI in", () => {
	const URL = "https://auth.openai.com/oauth/authorize?client_id=app_x";

	test("signs in with the CLI's own command, takes a code, then adds the harness and a profile", async () => {
		const answers = checks("signed_out", "signed_in");
		let proc: FakeProcess | undefined;
		const { spawn } = fakeSpawn((started) => {
			proc = started;
		});
		const s = make({
			spawn,
			check: answers.check,
			which: computer({ codex: "/opt/bin/codex", curl: "/usr/bin/curl" }),
		});
		expect(s.signIn("codex", HERE).job.state).toBe("checking");
		await until(s, "codex", "signing-in");
		expect(proc?.argv).toEqual(["/opt/bin/codex", "login"]);

		proc?.print(`\u001b[2mGo to\u001b[0m ${URL}\nEnter the code: `);
		expect(await until(s, "codex", "code-needed")).toMatchObject({ url: URL });

		s.sendCode("codex", "  ABCD-1234\n", HERE);
		expect(proc?.written).toEqual(["ABCD-1234\n"]);
		expect(jobOf(s, "codex")).toMatchObject({ state: "signing-in", url: URL });

		proc?.exit(0);
		const ready = await until(s, "codex", "ready");
		expect(ready).toMatchObject({ profileName: "codex", account: ADA });
		// Checked before and after: each check notes `agent-checked` in the daemon.
		expect(answers.asked).toEqual(["codex codex", "codex codex"]);
		expect(stores.settings.current().harnesses).toContain("codex");
		const profile = stores.profiles.byName("codex");
		expect(profile).toMatchObject({
			harness: "codex",
			model: "gpt-5.3-codex",
			permissionMode: stores.settings.current().agentPermissionMode,
		});
		expect(ready).toMatchObject({ profileId: profile?.id ?? "missing" });
	});

	test("a CLI signed in already needs no sign-in, and keeps the profile it has", async () => {
		await stores.settings.save({ harnesses: ["claude-code"] });
		await stores.profiles.save({
			name: "night",
			harness: "claude-code",
			model: "opus",
			permissionMode: "auto",
			clis: [],
			connections: [],
		});
		const { spawn, started } = fakeSpawn();
		const s = make({
			spawn,
			check: checks("signed_in").check,
			which: computer({ claude: "/usr/local/bin/claude" }),
		});
		s.signIn("claude-code", HERE);
		expect(await until(s, "claude-code", "ready")).toMatchObject({
			profileName: "night",
		});
		expect(started).toHaveLength(0);
		expect(
			stores.profiles
				.list()
				.filter((p) => isAgentProfile(p) && p.harness === "claude-code"),
		).toHaveLength(1);
	});

	test("a sign-in that ends without a login fails in plain words", async () => {
		const { spawn } = fakeSpawn((proc) => proc.exit(1));
		const s = make({
			spawn,
			which: computer({ claude: "/usr/local/bin/claude" }),
		});
		s.signIn("claude-code", HERE);
		expect(await until(s, "claude-code", "sign-in-failed")).toMatchObject({
			problem: "Claude Code is not signed in yet. Try again.",
		});
		expect(stores.profiles.list()).toHaveLength(0);
	});

	test("a cancel stops the sign-in, and a timeout too", async () => {
		const first = fakeSpawn();
		const s = make({
			spawn: first.spawn,
			which: computer({ claude: "/usr/local/bin/claude" }),
		});
		s.signIn("claude-code", HERE);
		await until(s, "claude-code", "signing-in");
		expect(s.cancel("claude-code", HERE).job.state).toBe("cancelled");
		expect(first.started[0]?.stopped).toBe(true);
		await Bun.sleep(10);
		expect(jobOf(s, "claude-code").state).toBe("cancelled");

		const second = fakeSpawn();
		const timed = make({
			spawn: second.spawn,
			which: computer({ claude: "/usr/local/bin/claude" }),
			signInTimeoutMs: 20,
		});
		timed.signIn("claude-code", HERE);
		expect(await until(timed, "claude-code", "sign-in-failed")).toMatchObject({
			problem: "The sign-in took too long. Night Shift stopped it. Try again.",
		});
		expect(second.started[0]?.stopped).toBe(true);
	});

	test("is refused without the CLI, and a code without a waiting sign-in", () => {
		const { spawn } = fakeSpawn();
		const s = make({ spawn });
		expect(() => s.signIn("claude-code", HERE)).toThrow(
			"Claude Code is not installed on this computer. Install it first.",
		);
		expect(() => s.sendCode("claude-code", "abc", HERE)).toThrow(
			"Claude Code is not waiting for a code. Start the sign-in again.",
		);
	});

	test("a stop of the daemon stops every job", async () => {
		const { spawn, started } = fakeSpawn();
		const s = make({
			spawn,
			which: computer({ codex: "/opt/bin/codex", curl: "/usr/bin/curl" }),
		});
		s.install("claude-code", HERE);
		s.signIn("codex", HERE);
		await until(s, "codex", "signing-in");
		s.stop();
		expect(started.map((p) => p.stopped)).toEqual([true, true]);
		expect(jobOf(s, "claude-code").state).toBe("cancelled");
		expect(jobOf(s, "codex").state).toBe("cancelled");
	});
});
