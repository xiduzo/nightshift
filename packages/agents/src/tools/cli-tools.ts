/**
 * CLI tools: programs on this computer that the agents may run. Where each
 * one is, its version, and its own help, which the agents read. Every check
 * is read-only.
 */
import { access, constants, readdir, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { now } from "@nightshift/time";
import { type CliCheck, firstLine, probe } from "../doctor";

/** A CLI tool's check: the CLI check, plus the help the agents read. */
export type CliToolCheck = CliCheck & {
	/** The program's own help (`--help`), cut to `HELP_MAX_CHARS`. Null when it has none. */
	help: string | null;
};

/**
 * A CLI tool (a program the agents may run): where it is, its version and
 * its help. Many programs do not know `--version`, so a missing version is
 * no problem. A login (`gh auth status`, `aws sts get-caller-identity`) is
 * the agent's own business: the check is the same for every program.
 */
export async function checkCli(
	name: string,
	searchPath: string = process.env.PATH ?? "",
): Promise<CliToolCheck> {
	const check = await programCheck(name, searchPath);
	return { ...check, help: check.path ? await cliHelpAt(check.path) : null };
}

async function programCheck(
	name: string,
	searchPath: string,
): Promise<CliCheck> {
	const path = Bun.which(name, { PATH: searchPath });
	const check: CliCheck = {
		bin: name,
		path,
		version: null,
		account: null,
		facts: [],
		problem: path
			? null
			: `Night Shift cannot find ${name} on this computer. Install it, then check again.`,
		checkedAt: now(),
	};
	if (!path) return check;
	try {
		const out = await probe([path, "--version"]);
		return out.code === 0
			? { ...check, version: firstLine(out.stdout) }
			: check;
	} catch {
		return check;
	}
}

/** At most this much of a program's help: its commands and flags, not a manual. */
export const HELP_MAX_CHARS = 8_000;

/** No pager, no color, no cursor tricks, and lines a prompt can hold. */
const HELP_ENV: Record<string, string> = {
	PAGER: "cat",
	MANPAGER: "cat",
	GIT_PAGER: "cat",
	TERM: "dumb",
	CLICOLOR: "0",
	COLUMNS: "100",
};

/** Help text as plain text: no terminal escapes, no man-page overstrike, no blank runs. */
export function plainHelp(text: string): string {
	return (
		text
			// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escapes.
			.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: overstrike (`X\bX`, `_\bX`).
			.replace(/[^\n]\x08/g, "")
			.replace(/\r\n?/g, "\n")
			.replace(/[ \t]+$/gm, "")
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	);
}

/** Cuts help at the last whole line within `HELP_MAX_CHARS`, and says so. */
function capHelp(text: string): string {
	if (text.length <= HELP_MAX_CHARS) return text;
	const cut = text.slice(0, HELP_MAX_CHARS);
	const lastLine = cut.lastIndexOf("\n");
	return `${lastLine > 0 ? cut.slice(0, lastLine) : cut}\n…`;
}

/**
 * The program's own help: `--help`, else `-h`. Many programs print it to
 * stderr, and some exit non-zero after it: that counts when the text has a
 * usage line. Null when neither flag answers with help.
 */
export async function cliHelpAt(path: string): Promise<string | null> {
	for (const flag of ["--help", "-h"]) {
		try {
			const out = await probe([path, flag], HELP_ENV);
			const text = plainHelp(out.stdout.trim() ? out.stdout : out.stderr);
			if (text && (out.code === 0 || /usage/i.test(text))) {
				return capHelp(text);
			}
		} catch {
			// Try the next flag.
		}
	}
	return null;
}

const helpCache = new Map<string, { stamp: string; help: string }>();

/**
 * A CLI tool's help for an agent session: `cliHelpAt`, kept until the
 * program changes (a new version is a new file). Null when this computer
 * cannot find it, or it has no help.
 */
export async function cliHelp(
	name: string,
	searchPath: string = process.env.PATH ?? "",
): Promise<string | null> {
	const path = Bun.which(name, { PATH: searchPath });
	if (!path) return null;
	let stamp: string;
	try {
		const info = await stat(path);
		stamp = `${info.mtimeMs}:${info.size}`;
	} catch {
		return null;
	}
	const cached = helpCache.get(path);
	if (cached?.stamp === stamp) return cached.help;
	const help = await cliHelpAt(path);
	// No help may be a slow start or a timeout: ask again next time.
	if (help) helpCache.set(path, { stamp, help });
	return help;
}

/**
 * The programs this computer can run by name: every executable file in the
 * directories of the daemon's PATH, sorted, each name once.
 */
export async function pathPrograms(
	path: string = process.env.PATH ?? "",
): Promise<string[]> {
	const names = new Set<string>();
	for (const dir of new Set(path.split(delimiter).filter(Boolean))) {
		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch {
			continue;
		}
		await Promise.all(
			entries.map(async (entry) => {
				if (names.has(entry) || entry.startsWith(".")) return;
				try {
					const file = join(dir, entry);
					if (!(await stat(file)).isFile()) return;
					await access(file, constants.X_OK);
					names.add(entry);
				} catch {
					// Not executable, or a broken link.
				}
			}),
		);
	}
	return [...names].sort((a, b) => a.localeCompare(b));
}
