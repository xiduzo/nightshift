import { describe, expect, test } from "bun:test";
import { harnessSetup } from "@nightshift/agents/harness-facts";

import { installCommand, startInstall } from "./install";
import { fakeSpawn } from "./test-support";

const claude = harnessSetup("claude-code");
const codex = harnessSetup("codex");
if (!claude || !codex) throw new Error("Claude Code and Codex have a setup.");

describe("the install of an agent CLI", () => {
	test("runs the vendor's own command, as the person reads it", () => {
		expect(installCommand(claude)).toBe(
			"curl -fsSL https://claude.ai/install.sh | bash",
		);
		expect(installCommand(codex)).toBe(
			"curl -fsSL https://chatgpt.com/codex/install.sh | sh",
		);
	});

	test("starts it in the home folder, without input, with the vendor's variables", async () => {
		const { spawn, started } = fakeSpawn();
		const run = startInstall({
			command: installCommand(codex),
			extraEnv: codex.installEnv,
			spawn,
			home: "/home/ada",
			env: { PATH: "/usr/bin", HOME: "/home/ada" },
		});
		const proc = started[0];
		if (!proc) throw new Error("The install did not start.");
		expect(proc.argv).toEqual([
			"/bin/sh",
			"-c",
			"curl -fsSL https://chatgpt.com/codex/install.sh | sh",
		]);
		expect(proc.options).toMatchObject({
			cwd: "/home/ada",
			io: "pipes",
			input: false,
			env: {
				PATH: "/usr/bin",
				HOME: "/home/ada",
				CODEX_NON_INTERACTIVE: "1",
			},
		});
		proc.print("\u001b[32mInstalled codex to /home/ada/.local/bin\u001b[0m\n");
		proc.exit(0);
		expect(await run.ended).toEqual({
			kind: "done",
			output: "Installed codex to /home/ada/.local/bin",
		});
	});

	test("a failed install keeps the end of its output, without colors", async () => {
		const { spawn, started } = fakeSpawn();
		const run = startInstall({
			command: installCommand(claude),
			spawn,
			home: "/h",
			env: {},
		});
		const proc = started[0];
		if (!proc) throw new Error("The install did not start.");
		proc.print(`${"downloading…\n".repeat(400)}`);
		proc.print(
			"\u001b[31mcurl: (22) The requested URL returned error: 404\u001b[0m\n",
		);
		proc.exit(22);
		const end = await run.ended;
		expect(end.kind).toBe("failed");
		if (end.kind !== "failed") return;
		expect(end.code).toBe(22);
		expect(end.output.length).toBeLessThanOrEqual(2_000);
		expect(end.output).toEndWith(
			"curl: (22) The requested URL returned error: 404",
		);
		expect(end.output).not.toContain("\u001b");
	});

	test("a timeout stops the installer and every program it started", async () => {
		const { spawn, started } = fakeSpawn((proc) => proc.print("working\n"));
		const run = startInstall({
			command: installCommand(claude),
			spawn,
			home: "/h",
			env: {},
			timeoutMs: 20,
		});
		expect(await run.ended).toEqual({ kind: "timed-out", output: "working" });
		expect(started[0]?.stopped).toBe(true);
	});

	test("a stop ends it as stopped", async () => {
		const { spawn, started } = fakeSpawn();
		const run = startInstall({
			command: installCommand(claude),
			spawn,
			home: "/h",
			env: {},
		});
		run.stop();
		expect(await run.ended).toEqual({ kind: "stopped" });
		expect(started[0]?.stopped).toBe(true);
	});
});
