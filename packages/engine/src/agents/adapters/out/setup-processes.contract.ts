import { expect } from "bun:test";

import type { SetupProcesses } from "../../application/ports";
import type { SetupFacts, SignInSight } from "../../domain/setup-runs";

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
		/** The program that started last prints this. */
		print: (text: string) => void | Promise<void>;
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
				name: "an install that fails keeps its code and its output, without colors",
				run: async () => {
					const { processes, print, finish, command, home, env } = make();
					const run = processes.startInstall({ command, home, env });
					await print("\u001b[31mNo such page\u001b[0m\n");
					await finish(22);
					expect(await run.ended).toEqual({
						kind: "failed",
						code: 22,
						output: "No such page",
					});
				},
			},
			{
				name: "an install that takes too long is stopped",
				run: async () => {
					const { processes, command, home, env } = make();
					const run = processes.startInstall({
						command,
						home,
						env,
						timeoutMs: 20,
					});
					expect(await run.ended).toEqual({ kind: "timed-out", output: "" });
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
			{
				name: "a sign-in tells the address and the question, until the code goes in",
				run: async () => {
					const { processes, print, finish, program, home, env } = make();
					const sights: SignInSight[] = [];
					let seen = () => {};
					const asked = new Promise<void>((resolve) => {
						seen = resolve;
					});
					const run = processes.startSignIn({
						program,
						setup: SETUP,
						home,
						env,
						onSight: (sight) => {
							sights.push(sight);
							if (sight.url && sight.codeNeeded) seen();
						},
					});
					await print(
						"Open https://evil.example/x or https://claude.ai/login?x=1\nPaste code here > ",
					);
					await asked;
					const url = "https://claude.ai/login?x=1";
					expect(sights.at(-1)).toEqual({ url, codeNeeded: true });
					run.sendCode("abc");
					expect(sights.at(-1)).toEqual({ url, codeNeeded: false });
					await finish(1);
					expect(await run.ended).toEqual({ kind: "exited", code: 1 });
				},
			},
			{
				name: "a stop ends a sign-in as stopped, too much time as timed out",
				run: async () => {
					const { processes, program, home, env } = make();
					const start = (timeoutMs?: number) =>
						processes.startSignIn({
							program,
							setup: SETUP,
							home,
							env,
							onSight: () => {},
							timeoutMs,
						});
					const stopped = start();
					stopped.stop();
					expect(await stopped.ended).toEqual({ kind: "stopped" });
					expect(await start(20).ended).toEqual({ kind: "timed-out" });
				},
			},
		],
	};
}
