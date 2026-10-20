/**
 * Read-only probes of a program on this computer: find it, and run it once
 * with a timeout (`--version`, `auth status`, `--help` and the like).
 * Nothing here starts a session.
 */
import { stat } from "node:fs/promises";
import { homedir } from "node:os";

const TIMEOUT_MS = 15_000;

export type ProbeOutput = { code: number; stdout: string; stderr: string };

/** Runs one program in the home folder, without color, and kills it after 15 s. */
export async function probe(
	argv: string[],
	env: Record<string, string> = {},
): Promise<ProbeOutput> {
	const child = Bun.spawn(argv, {
		cwd: homedir(),
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1", ...env },
	});
	const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { code, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}

/** The executable's path: a path as given when it exists, else the PATH lookup. */
export async function resolveBin(bin: string): Promise<string | null> {
	if (bin.includes("/")) {
		const path = bin.startsWith("~/") ? homedir() + bin.slice(1) : bin;
		try {
			return (await stat(path)).isFile() ? path : null;
		} catch {
			return null;
		}
	}
	return Bun.which(bin);
}

/** The first line of a text that is not blank, trimmed. */
export function firstLine(text: string): string | null {
	return (
		text
			.split("\n")
			.map((l) => l.trim())
			.find(Boolean) ?? null
	);
}
