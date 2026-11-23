import { expect } from "bun:test";

import type { SetupProcesses } from "../../application/ports";
import type { SetupFacts } from "../../domain/setup-runs";

const SETUP: SetupFacts = {
	vendor: "Anthropic",
	installScript: "https://claude.ai/install.sh",
	installShell: "bash",
	installEnv: {},
	binDir: ".local/bin",
	signIn: ["auth", "login"],
	signInHosts: ["claude.ai"],
	signInIo: "pipes",
	program: "claude",
};

/** The contract of SetupProcesses: an install and a sign-in start and stop. */
export function setupProcessesContract(
	name: string,
	make: () => {
		processes: SetupProcesses;
		finishInstall: (code: number) => void;
		finishSignIn: (code: number) => void;
	},
) {
	return {
		name,
		cases: [
			{
				name: "an install that exits 0 is done",
				run: async () => {
					const { processes, finishInstall } = make();
					const run = processes.startInstall({
						command: "curl -fsSL https://claude.ai/install.sh | bash",
						home: "/home/ada",
						env: { PATH: "/usr/bin" },
					});
					finishInstall(0);
					expect(await run.ended).toMatchObject({ kind: "done" });
				},
			},
			{
				name: "a stop ends an install as stopped",
				run: async () => {
					const { processes } = make();
					const run = processes.startInstall({
						command: "true",
						home: "/h",
						env: {},
					});
					run.stop();
					expect(await run.ended).toEqual({ kind: "stopped" });
				},
			},
			{
				name: "a sign-in that exits is exited",
				run: async () => {
					const { processes, finishSignIn } = make();
					const run = processes.startSignIn({
						program: "claude",
						setup: SETUP,
						home: "/home/ada",
						env: {},
						onSight: () => {},
					});
					finishSignIn(0);
					expect(await run.ended).toEqual({ kind: "exited", code: 0 });
				},
			},
		],
	};
}
