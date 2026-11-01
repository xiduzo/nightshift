/**
 * Checks for the Connections page: is each CLI on this machine, which
 * version, and whose login does it use. Every check is read-only: `--version`,
 * `auth status` and the like. Nothing here starts a session.
 *
 * The checks that know one harness (its login, its supported versions) are
 * in that harness's folder (`harnesses/<harness>/record.ts`). They build on
 * `baseCheck`.
 */

import { now } from "@nightshift/time";
import { firstLine, probe, resolveBin } from "./probe";

export type CliCheck = {
	/** The executable as configured: a name on the PATH, or a path. */
	bin: string;
	/** Where it resolved to. Null when it is not there. */
	path: string | null;
	version: string | null;
	/** Whose login the CLI uses, when it says. */
	account: string | null;
	/** More facts, label → value, for example a plan or token scopes. */
	facts: { label: string; value: string }[];
	/** Why it cannot run Night Shift's sessions. Null when it can. */
	problem: string | null;
	checkedAt: number;
};

/** Is `bin` there, and which version: `<bin> --version`. */
export async function baseCheck(
	bin: string,
	label: string,
): Promise<CliCheck & { resolved: string | null }> {
	const path = await resolveBin(bin);
	const base = {
		bin,
		path,
		resolved: path,
		version: null,
		account: null,
		facts: [],
		problem: null,
		checkedAt: now(),
	};
	if (!path) {
		return {
			...base,
			problem: bin.includes("/")
				? `Nothing is installed at ${bin}. Check the path.`
				: `${label} is not installed, or Night Shift cannot find it. Install it, or enter its path.`,
		};
	}
	try {
		const out = await probe([path, "--version"]);
		if (out.code !== 0) {
			return {
				...base,
				problem:
					firstLine(out.stderr) ??
					`${label} failed when Night Shift checked its version.`,
			};
		}
		return { ...base, version: firstLine(out.stdout) };
	} catch (error) {
		return { ...base, problem: String(error) };
	}
}

/**
 * A custom agent's command: is it on this computer, and its version when it
 * answers `--version`. Many agents do not, so no version is no problem.
 */
export async function checkCustomAgent(
	command: string,
	label: string,
): Promise<CliCheck> {
	const path = await resolveBin(command);
	const check: CliCheck = {
		bin: command,
		path,
		version: null,
		account: null,
		facts: [],
		problem: null,
		checkedAt: now(),
	};
	if (!path) {
		return {
			...check,
			problem: command.includes("/")
				? `Nothing is installed at ${command}. Check the path.`
				: `Night Shift cannot find ${command} on this computer. Install ${label}, or enter the full path of its command.`,
		};
	}
	try {
		const out = await probe([path, "--version"]);
		return out.code === 0
			? { ...check, version: firstLine(out.stdout) }
			: check;
	} catch {
		return check;
	}
}
