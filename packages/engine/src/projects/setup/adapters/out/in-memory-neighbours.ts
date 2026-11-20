import type { GitInstall } from "../../../../git";
import type { GitInstaller, Programs } from "../../application/ports";
import { inMemoryProjectFolders } from "./in-memory-project-folders";

/**
 * The in-memory adapters of the ports that another vertical fills
 * (`@filledBy` in `application/ports.ts`), and `inMemorySetupPorts`, which
 * gives a use-case test every port of the setup at once. Test code:
 * production code never imports this file.
 */

/** The programs of a computer: `found` are there. */
export function inMemoryPrograms(
	found: readonly string[] = ["jq", "curl"],
	platform = "linux",
) {
	return {
		platform,
		which: (name: string) => (found.includes(name) ? `/usr/bin/${name}` : null),
	} satisfies Programs;
}

/** The git installer: what it answers, and how often it was asked. */
export function inMemoryGitInstaller(answer: GitInstall = { kind: "started" }) {
	const twin = {
		asked: 0,
		async install() {
			twin.asked += 1;
			return answer;
		},
	};
	return twin satisfies GitInstaller;
}

/** Every port of the setup in memory at once: where each use-case test starts. */
export function inMemorySetupPorts() {
	return {
		folders: inMemoryProjectFolders(),
		programs: inMemoryPrograms(),
		installer: inMemoryGitInstaller(),
	};
}
