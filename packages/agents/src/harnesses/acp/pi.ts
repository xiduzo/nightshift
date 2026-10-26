/**
 * What is pi's own: pi has no ACP mode, so pi-acp (a dependency of this
 * package) runs `pi --mode rpc` and speaks ACP for it. Also its install
 * check and its model listing.
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Refusal } from "@nightshift/refusal";
import { baseCheck, type CliCheck, firstLine, probe } from "../../doctor";
import { shellQuoteAlways } from "../../port";

/** pi's tools that only read: its own read-only mode (`pi --tools read,grep,find,ls`). */
export const PI_READ_TOOLS = ["read", "grep", "find", "ls"] as const;

/** The script that runs `pi` with its read tools only, passing every argument on. */
export function piReadOnlyScript(pi: string): string {
	return [
		"#!/bin/sh",
		"# Night Shift: a read-only session. pi gets its read tools only.",
		`exec ${shellQuoteAlways(pi)} --tools ${PI_READ_TOOLS.join(",")} "$@"`,
		"",
	].join("\n");
}

/**
 * pi asks no permission before it edits or runs a command, so a read-only
 * session cannot refuse one. pi-acp starts the pi that `PI_ACP_PI_COMMAND`
 * names, with no arguments of ours: this writes a script that starts `pi`
 * with its read tools only, in a private temp folder, and gives its path.
 */
export async function piReadOnly(
	pi: string,
): Promise<{ executable: string; cleanup: () => Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "nightshift-pi-"));
	const executable = join(dir, "pi");
	await writeFile(executable, piReadOnlyScript(pi), { mode: 0o700 });
	return {
		executable,
		cleanup: () => rm(dir, { recursive: true, force: true }),
	};
}

/**
 * The command that starts pi-acp: its entry point, run with this process's
 * runtime (Bun). Resolved when a pi session starts, not when this module
 * loads: a build without pi-acp on disk (the `nightshift` binary) must
 * still start. Throws when pi-acp is missing.
 */
export function piAcpCommand(): string[] {
	let entry: string | undefined;
	try {
		entry = fileURLToPath(import.meta.resolve("pi-acp"));
	} catch {
		// Not installed next to this module.
	}
	if (!entry || !existsSync(entry)) {
		throw new Refusal(
			"unavailable",
			"Night Shift cannot start pi on this computer: a part it needs is missing. Install Night Shift again, or run the node on another harness.",
		);
	}
	return [process.execPath, entry];
}

/**
 * Runs pi-acp in this process. It speaks ACP on stdin and stdout until
 * stdin closes. For a build that carries pi-acp inside and starts itself
 * as pi-acp (see `AcpHarnessOptions.piAcp`).
 */
export async function runPiAcp(): Promise<void> {
	// @ts-expect-error pi-acp has no types: it is a program, run when it loads.
	await import("pi-acp");
}

/** The oldest pi that pi-acp works with: it asks pi for its thinking levels. */
export const PI_MIN_VERSION = "0.81.0";

/** True when version `a` (`x.y.z`) is older than `b`. */
function olderThan(a: string, b: string): boolean {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d < 0;
	}
	return false;
}

/** pi-acp waits forever on a pi that is too old: say so here instead. */
export async function piCheck(bin: string): Promise<CliCheck> {
	const { resolved, ...check } = await baseCheck(bin, "pi");
	if (!resolved || check.problem) return check;
	// pi 0.73 prints its version to stderr.
	const printed =
		check.version ?? firstLine((await probe([resolved, "--version"])).stderr);
	const version = printed?.match(/\d+\.\d+\.\d+/)?.[0];
	if (!version) return check;
	if (olderThan(version, PI_MIN_VERSION)) {
		return {
			...check,
			version,
			problem: `pi ${version} is too old. Night Shift needs pi 0.81 or later. Update pi, or enter the path of a newer one.`,
		};
	}
	return { ...check, version };
}

/**
 * `pi --list-models` prints a table, to stderr in pi 0.73: a header, then
 * `provider  model  context …` per row. Each row becomes `provider/model`.
 */
export function piModels(out: { stdout: string; stderr: string }): string[] {
	const text = out.stdout.trim() ? out.stdout : out.stderr;
	return text
		.split("\n")
		.map((line) => line.trim().split(/\s+/))
		.flatMap(([provider, model]) =>
			provider && model && provider !== "provider"
				? [`${provider}/${model}`]
				: [],
		);
}
