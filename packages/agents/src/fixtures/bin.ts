import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Write an executable wrapper `<dir>/<name>` that runs one fixture script
 * with Bun and the given environment. Returns its path.
 */
export async function fakeBin(
	dir: string,
	name: string,
	fixture: "fake-gh" | "fake-claude" | "fake-opencode" | "fake-codex",
	env: Record<string, string> = {},
): Promise<string> {
	const path = join(dir, name);
	const script = join(import.meta.dir, `${fixture}.ts`);
	const exports = Object.entries(env)
		.map(([key, value]) => `export ${key}=${quote(value)}`)
		.join("\n");
	await writeFile(
		path,
		`#!/bin/sh\n${exports}\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,
	);
	await chmod(path, 0o755);
	return path;
}
