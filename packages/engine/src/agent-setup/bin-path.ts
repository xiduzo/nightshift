import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { harnessSetup } from "@nightshift/agents/harness-facts";
import { harnessNameSchema } from "@nightshift/flows";

/**
 * The folders the vendors' installers put an agent CLI in (`~/.local/bin`),
 * on the PATH Night Shift looks for programs on. An app started from the
 * Finder or the Dock, and a service, get a short PATH without them.
 */

/** The bin folders of the guided setups, relative to the home folder, once each. */
function agentBinDirs(): string[] {
	const dirs = harnessNameSchema.options.flatMap((name) => {
		const setup = harnessSetup(name);
		return setup ? [setup.binDir] : [];
	});
	return [...new Set(dirs)];
}

/**
 * Puts each agent bin folder that exists first on `env.PATH`, unless the
 * PATH has it already: then the order the person's own shell chose stays.
 * The daemon calls it before it starts (`prepareDaemonEnv`), and the guided
 * setup after an install. Returns whether the PATH changed.
 */
export function putAgentBinsOnPath(
	env: Record<string, string | undefined> = process.env,
	home: string = env.HOME || homedir(),
): boolean {
	const path = (env.PATH ?? "").split(delimiter).filter(Boolean);
	const missing = agentBinDirs()
		.map((dir) => join(home, dir))
		.filter((dir) => !path.includes(dir) && existsSync(dir));
	if (missing.length === 0) return false;
	env.PATH = [...missing, ...path].join(delimiter);
	return true;
}
