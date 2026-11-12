import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { now } from "@nightshift/time";

import { systemSpawn } from "./spawn";

/**
 * Bun's spawn with tiny fake CLIs in a temp folder: never a real installer
 * or a real sign-in, and nothing on the real PATH.
 */

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-setup-spawn-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function script(name: string, body: string): Promise<string> {
	const path = join(dir, name);
	await writeFile(path, `#!/bin/sh\n${body}\n`);
	await chmod(path, 0o755);
	return path;
}

describe("the system spawn of the guided setup", () => {
	test("pipes: reads the output and the error output, writes a code, gives the exit code", async () => {
		const cli = await script(
			"fake-login",
			[
				// An ANSI-colored address, a question, then the code it gets.
				"printf '\\033[36mhttps://claude.ai/oauth/authorize?x=1\\033[0m\\n'",
				"printf 'Paste code here if prompted > ' >&2",
				"read code",
				'test -t 0 && echo "a terminal" || echo "no terminal"',
				'echo "got $code"',
				'[ "$code" = "abc" ] && exit 0 || exit 1',
			].join("\n"),
		);
		let output = "";
		const proc = systemSpawn([cli], {
			cwd: dir,
			env: { PATH: "/usr/bin:/bin" },
			io: "pipes",
			input: true,
			onOutput: (text) => {
				output += text;
			},
		});
		while (!output.includes("Paste code")) await Bun.sleep(5);
		proc.write("abc\n");
		expect(await proc.exited).toBe(0);
		expect(output).toContain("\u001b[36mhttps://claude.ai/oauth/authorize?x=1");
		expect(output).toContain("no terminal");
		expect(output).toContain("got abc");
	});

	test("pipes without input: the program reads nothing", async () => {
		const cli = await script(
			"fake-install",
			'read line || echo "no input"; exit 3',
		);
		let output = "";
		const proc = systemSpawn([cli], {
			cwd: dir,
			env: {},
			io: "pipes",
			input: false,
			onOutput: (text) => {
				output += text;
			},
		});
		proc.write("ignored\n");
		expect(await proc.exited).toBe(3);
		expect(output).toContain("no input");
	});

	test("a terminal: the program sees one, and gets the code", async () => {
		const cli = await script(
			"fake-tty-login",
			[
				'test -t 0 && echo "a terminal" || { echo "no terminal"; exit 1; }',
				"printf 'Enter code: '",
				"read code",
				'echo "got $code"',
			].join("\n"),
		);
		let output = "";
		const proc = systemSpawn([cli], {
			cwd: dir,
			env: { PATH: "/usr/bin:/bin" },
			io: "terminal",
			input: true,
			onOutput: (text) => {
				output += text;
			},
		});
		while (!output.includes("Enter code")) await Bun.sleep(5);
		proc.write("1234\r");
		expect(await proc.exited).toBe(0);
		expect(output).toContain("a terminal");
		expect(output).toContain("got 1234");
	});

	test("a stop ends the program and the programs it started", async () => {
		const marker = join(dir, "child-pid");
		const cli = await script(
			"fake-slow",
			[`sleep 30 & echo $! > ${marker}`, "echo started", "wait"].join("\n"),
		);
		let output = "";
		const proc = systemSpawn([cli], {
			cwd: dir,
			env: { PATH: "/usr/bin:/bin" },
			io: "pipes",
			input: false,
			onOutput: (text) => {
				output += text;
			},
		});
		while (!output.includes("started")) await Bun.sleep(5);
		const started = now();
		proc.stop();
		await proc.exited;
		expect(now() - started).toBeLessThan(5_000);
		const child = Number((await Bun.file(marker).text()).trim());
		await Bun.sleep(50);
		expect(() => process.kill(child, 0)).toThrow();
	});
});
