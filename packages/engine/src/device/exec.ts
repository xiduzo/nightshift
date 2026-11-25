import { delimiter } from "node:path";

import { spawnCommand } from "./command";
import { ARTIFACTS_ENV, type KeptFiles, openKeptFiles } from "./kept-files";
import type { DeviceConnections, LocalDeviceDeps } from "./local-deps";
import { PAGE_READER_NAMES } from "./scrubbed";
import { stepSecrets } from "./step-secrets";
import type { ToolLaunchers } from "./tool-launchers";
import type { ExecEvent, ExecInput } from "./types";

/** Whether a command's text names a CLI tool, as a word of its own. */
function namesTool(command: string, tool: string): boolean {
	const name = tool.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);
	return new RegExp(`(^|[^\\w.-])${name}($|[^\\w.-])`).test(command);
}

/** One command on this computer. */
export function localExec(
	deps: LocalDeviceDeps,
	connections: DeviceConnections,
) {
	return exec;

	/**
	 * `sh -c` here. A command's secrets come from the scopes of its use
	 * (`secretScopes`), on this computer: one it does not have refuses the
	 * command before it starts. Their values go to the command only; its
	 * output has them as `•••` before it leaves this computer.
	 *
	 * Each CLI tool with a login runs through its launcher, found first on
	 * PATH: `gh` in the command runs as the gh tool. The login's values go
	 * to the launcher only, and come back as `•••` too.
	 */
	async function* exec(input: ExecInput): AsyncGenerator<ExecEvent> {
		const {
			secrets: named = [],
			knowledge,
			run,
			artifacts,
			...command
		} = input;
		const secrets = stepSecrets(connections, run);
		// The secrets of the CLI tools' logins go to their launchers only. A
		// command that names one in `secrets` gets it below.
		const scrub = [
			...PAGE_READER_NAMES,
			...(deps.toolLaunchers?.guarded() ?? []).filter(
				(name) => !named.includes(name),
			),
		];
		const found = await secrets.env(named, "The command");
		if (!found.ok) {
			yield { type: "refused", message: found.message };
			return;
		}
		// The knowledge as the Space has it now, before the command reads it.
		// The sync flows write in its folder. The key of its page reader comes
		// from the scopes of this step, as a secret the command names would.
		const known =
			knowledge && deps.knowledge
				? await deps.knowledge.forCommand(knowledge.projectId, {
						secret: secrets.one,
					})
				: null;
		let tools: Awaited<ReturnType<ToolLaunchers["forCommand"]>> | null = null;
		let kept: KeptFiles | null = null;
		try {
			tools = (await deps.toolLaunchers?.forCommand(secrets.use)) ?? null;
			// The files the command puts in `NS_ARTIFACTS` become artifacts of
			// the run here, on the computer that runs it, as an agent's do.
			kept =
				artifacts && deps.artifacts
					? openKeptFiles(deps.artifacts, artifacts)
					: null;
			const leftOut = (tools?.leftOut ?? []).filter(({ tool }) =>
				namesTool(command.command, tool),
			);
			const env: Record<string, string> = {
				...known?.env,
				...command.env,
				...tools?.env,
				...found.env,
				...(kept ? { [ARTIFACTS_ENV]: kept.path } : {}),
			};
			if (tools?.toolsPath) {
				env.PATH = [tools.toolsPath, command.env?.PATH ?? process.env.PATH]
					.filter(Boolean)
					.join(delimiter);
			}
			secrets.add(tools?.values);
			const events = spawnCommand({ ...command, env }, scrub);
			for await (const event of secrets.hideExec(events)) {
				// Why the command failed, last in its output: a tool it names that
				// could not run.
				if (event.type === "exit" && event.exitCode !== 0) {
					for (const { message } of leftOut) {
						const text = secrets.hideText(`${message}\n`);
						yield { type: "output", stream: "stderr", text };
					}
				}
				// The files it kept, before the step ends.
				if (event.type === "exit" && kept) {
					for (const problem of await kept.keep()) {
						const text = secrets.hideText(`${problem}\n`);
						yield { type: "output", stream: "stderr", text };
					}
				}
				yield event;
			}
		} finally {
			await tools?.cleanup();
			kept?.remove();
			// What the command changed, a sync's files, go to the Space.
			await known?.done();
		}
	}
}
