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
		/** The installer's command and the CLI: each runs until `finish`. */
		command: string;
		program: string;
		home: string;
		env: Record<string, string>;
		/** The program that started last exits with this code. */
		finish: (code: number) => void | Promise<void>;
	},
) {
	return {
		name,
		cases: [
			{
				name: "an install that exits 0 is done",
				run: async () => {
					const { processes, finish, command, home, env } = make();
					const run = processes.startInstall({
						command,
						home,
						env,
					});
					await finish(0);
					expect(await run.ended).toMatchObject({ kind: "done" });
				},
			},
			{
				name: "a stop ends an install as stopped",
				run: async () => {
					const { processes, command, home, env } = make();
					const run = processes.startInstall({
						command,
						home,
						env,
					});
					run.stop();
					expect(await run.ended).toEqual({ kind: "stopped" });
				},
			},
			{
				name: "a sign-in that exits is exited",
				run: async () => {
					const { processes, finish, program, home, env } = make();
					const run = processes.startSignIn({
						program,
						setup: SETUP,
						home,
						env,
						onSight: () => {},
					});
					await finish(0);
					expect(await run.ended).toEqual({ kind: "exited", code: 0 });
				},
			},
		],
	};
}
