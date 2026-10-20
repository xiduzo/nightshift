import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CliAnswer, fakeCli as fakeCliIn } from "../testing/fixtures/cli";
import {
	checkCli,
	cliHelp,
	cliHelpAt,
	HELP_MAX_CHARS,
	pathPrograms,
	plainHelp,
} from "./cli-tools";

/** Every CLI here is a tiny fake script: the checks never run a real one. */

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-cli-tools-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const fakeCli = (name: string, answers: Record<string, CliAnswer>) =>
	fakeCliIn(dir, name, answers);

describe("checkCli", () => {
	test("a program on the PATH: its path and version", async () => {
		const path = await fakeCli("acli", {
			"--version": { stdout: "acli 1.2.3\n" },
		});
		expect(await checkCli("acli", dir)).toMatchObject({
			bin: "acli",
			path,
			version: "acli 1.2.3",
			problem: null,
		});
	});

	test("a program without --version is still ready", async () => {
		await fakeCli("jq", {});
		expect(await checkCli("jq", dir)).toMatchObject({
			version: null,
			problem: null,
		});
	});

	test("a program that is not there has a problem", async () => {
		const check = await checkCli("nightshift-not-anywhere", dir);
		expect(check.path).toBeNull();
		expect(check.problem).toContain("cannot find nightshift-not-anywhere");
	});
});

describe("CLI tool help", () => {
	test("checkCli has the help the program prints for --help", async () => {
		await fakeCli("acli", {
			"--version": { stdout: "acli 1.2.3\n" },
			"--help": { stdout: "Usage: acli <command>\n\n  jira  Jira\n" },
		});
		expect((await checkCli("acli", dir)).help).toBe(
			"Usage: acli <command>\n\n  jira  Jira",
		);
	});

	test("help on stderr with a non-zero exit counts when it has a usage line", async () => {
		const path = await fakeCli("old", {
			"--help": { stderr: "usage: old [-v] file\n", code: 1 },
		});
		expect(await cliHelpAt(path)).toBe("usage: old [-v] file");
	});

	test("-h when --help is not known; nothing when neither answers", async () => {
		const short = await fakeCli("short", {
			"--help": { stderr: "unknown flag --help", code: 2 },
			"-h": { stdout: "short: does one thing\n" },
		});
		expect(await cliHelpAt(short)).toBe("short: does one thing");
		const silent = await fakeCli("silent", {});
		expect(await cliHelpAt(silent)).toBeNull();
	});

	test("long help is cut at a whole line", async () => {
		const line = `${"x".repeat(99)}\n`;
		const path = await fakeCli("big", {
			"--help": { stdout: line.repeat(200) },
		});
		const help = (await cliHelpAt(path)) ?? "";
		expect(help.length).toBeLessThanOrEqual(HELP_MAX_CHARS + 2);
		expect(help).toEndWith(`${"x".repeat(99)}\n…`);
	});

	test("terminal escapes and man-page overstrike go", () => {
		expect(
			plainHelp(
				"\x1b[1mNAME\x1b[0m\r\nN\bNA\bAM\bME\bE  \n\n\n\n_\bt_\bo_\bo_\bl",
			),
		).toBe("NAME\nNAME\n\ntool");
	});

	test("cliHelp finds the program by name, and nothing for a missing one", async () => {
		await fakeCli("acli", { "--help": { stdout: "Usage: acli\n" } });
		expect(await cliHelp("acli", dir)).toBe("Usage: acli");
		expect(await cliHelp("nightshift-not-anywhere", dir)).toBeNull();
	});
});

describe("pathPrograms", () => {
	test("the executables of each directory, sorted, each once", async () => {
		await fakeCli("zeta", {});
		await fakeCli("alpha", {});
		await writeFile(join(dir, "notes.txt"), "not a program");
		const other = join(dir, "other");
		await mkdir(other);
		await writeFile(join(other, "alpha"), "#!/bin/sh\n");
		await chmod(join(other, "alpha"), 0o755);
		expect(
			await pathPrograms(`${dir}:${other}:${join(dir, "missing")}`),
		).toEqual(["alpha", "zeta"]);
	});
});
