import type { AppRouterClient } from "@nightshift/api";
import { DEFAULT_PORT } from "@nightshift/daemon";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

/** One command of `nightshift`, as `main` lists and runs it. */
export type Command = {
	name: string;
	/** Its lines in the help. Null: the help does not name it. */
	help: string | null;
	/** `program`: how the person started it, for its usage. */
	run(argv: string[], program: string): Promise<void>;
};

type Definition<Options> = {
	name: string;
	help: string | null;
	usage(program: string): string;
	/** Where the usage alone goes. Default: stdout. */
	usageOn?: "stderr";
	/** Whether the arguments ask for the usage. */
	asksUsage?(argv: readonly string[]): boolean;
	/** The arguments over the environment. Throws when they do not make a command. */
	options(argv: string[]): Options;
	/** Its result is the exit code, when it gives one. */
	run(options: Options, program: string): Promise<number | undefined>;
};

/**
 * A command: it reads its arguments, shows its usage with exit code 2 when
 * they are wrong, and runs.
 */
export function command<Options>(definition: Definition<Options>): Command {
	const read = (argv: string[], program: string): Options => {
		try {
			return definition.options(argv);
		} catch (error) {
			const { message } = error as Error;
			const usage = definition.usage(program);
			if (message) console.error(`${message}\n\n${usage}`);
			else if (definition.usageOn === "stderr") console.error(usage);
			else console.log(usage);
			process.exit(2);
		}
	};
	return {
		name: definition.name,
		help: definition.help,
		async run(argv, program) {
			if (definition.asksUsage?.(argv)) {
				console.log(definition.usage(program));
				return;
			}
			const code = await definition.run(read(argv, program), program);
			if (code !== undefined) process.exitCode = code;
		},
	};
}

/**
 * A command that asks Night Shift on this computer. It ends with exit code
 * 1 when Night Shift does not run, or refuses.
 */
export function daemonCommand<Options extends { daemon: string }>(
	definition: Omit<Definition<Options>, "run"> & {
		run(client: AppRouterClient, options: Options): Promise<number | undefined>;
	},
): Command {
	return command({
		...definition,
		run: async (options) => {
			const client = await daemonClient(options.daemon);
			try {
				return await definition.run(client, options);
			} catch (error) {
				console.error(error instanceof Error ? error.message : error);
				process.exit(1);
			}
		},
	});
}

/** Night Shift on this computer: plain http on the loopback, also when it serves https:// to others. */
export function defaultDaemonUrl(
	env: Record<string, string | undefined> = process.env,
): string {
	return (
		env.NIGHTSHIFT_DAEMON_URL ?? `http://localhost:${env.PORT || DEFAULT_PORT}`
	);
}

/** The procedures of Night Shift at this address. It sends nothing yet. */
export function rpcClient(daemon: string): AppRouterClient {
	return createORPCClient(
		new RPCLink({ url: `${daemon.replace(/\/$/, "")}/rpc` }),
	);
}

/** The procedures of Night Shift on this computer, once it answers. Exits when it does not. */
async function daemonClient(daemon: string): Promise<AppRouterClient> {
	const client = rpcClient(daemon);
	try {
		await client.healthCheck();
	} catch {
		console.error(
			`Night Shift does not run on this computer (${daemon}). Start it first.`,
		);
		process.exit(1);
	}
	return client;
}

/**
 * Whether the person agrees, or said so with `--yes`. Exits without a
 * terminal to ask in: `needsYes` says what to add.
 */
export function agrees(
	yes: boolean,
	{ question, needsYes }: { question: string; needsYes: string },
): boolean {
	if (yes) return true;
	if (!process.stdin.isTTY) {
		console.error(needsYes);
		process.exit(2);
	}
	return confirm(question);
}
