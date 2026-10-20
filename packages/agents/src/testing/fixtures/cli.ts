import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { shellQuoteAlways } from "../../port";

/** What a fake CLI prints for one argv, and its exit code. */
export type CliAnswer = { stdout?: string; stderr?: string; code?: number };

/**
 * Writes an executable `<dir>/<name>` that answers each argv (joined with
 * spaces) as given. Any other argv exits 2, so a check that asks for
 * something else fails loudly. The install checks never run a real CLI.
 */
export async function fakeCli(
	dir: string,
	name: string,
	answers: Record<string, CliAnswer>,
): Promise<string> {
	const quote = shellQuoteAlways;
	const path = join(dir, name);
	const cases = Object.entries(answers)
		.map(
			([argv, a]) =>
				`  ${quote(argv)})\n    printf '%s' ${quote(a.stdout ?? "")}\n    printf '%s' ${quote(a.stderr ?? "")} >&2\n    exit ${a.code ?? 0};;`,
		)
		.join("\n");
	await writeFile(
		path,
		`#!/bin/sh\ncase "$*" in\n${cases}\n  *) echo "unexpected: $*" >&2; exit 2;;\nesac\n`,
	);
	await chmod(path, 0o755);
	return path;
}
