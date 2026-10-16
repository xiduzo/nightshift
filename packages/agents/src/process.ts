import { spawn } from "node:child_process";

export type ProcessResult = { code: number; stdout: string; stderr: string };

/** Never prompt, never page, never color: the output is for a program (`gh`, `git`). */
const QUIET_ENV: Record<string, string> = {
	GH_PROMPT_DISABLED: "1",
	GH_NO_UPDATE_NOTIFIER: "1",
	GH_SPINNER_DISABLED: "1",
	NO_COLOR: "1",
	CLICOLOR: "0",
	GIT_TERMINAL_PROMPT: "0",
};

/** Run one process without a shell. Resolves with its exit code; rejects only when it cannot start or is aborted. */
export function runProcess(
	command: string,
	args: readonly string[],
	options: {
		cwd: string;
		input?: string;
		env?: Record<string, string>;
		signal?: AbortSignal;
	},
): Promise<ProcessResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			cwd: options.cwd,
			env: { ...process.env, ...QUIET_ENV, ...options.env },
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
			...(options.signal ? { signal: options.signal } : {}),
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			if (error.name === "AbortError") {
				reject(new Error(`${command} was aborted`));
			} else if (error.code === "ENOENT") {
				reject(new Error(`${command} not found. Is it installed and on PATH?`));
			} else {
				reject(error);
			}
		});
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
		// A process that exits before reading stdin makes the write fail: ignore it.
		child.stdin.on("error", () => {});
		child.stdin.end(options.input ?? "");
	});
}
