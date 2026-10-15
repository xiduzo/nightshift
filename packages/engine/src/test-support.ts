import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentEvent,
	AgentHarness,
	AgentSessionInput,
} from "@nightshift/agents/types";
import { createDb, type Database } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";

import { git } from "./worktrees";

/** Test helpers: a temp git repo, a migrated temp database, scripted harnesses. */

export type Sandbox = {
	root: string;
	repoPath: string;
	dataDir: string;
	dbPath: string;
	db: Database;
	cleanup(): Promise<void>;
};

const gitIdentity = [
	"-c",
	"user.name=Night Shift Test",
	"-c",
	"user.email=test@nightshift.invalid",
	"-c",
	"commit.gpgsign=false",
];

export async function createSandbox(): Promise<Sandbox> {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "nightshift-engine-")),
	);
	const repoPath = join(root, "repo");
	await Bun.write(join(repoPath, "README.md"), "# test repo\n");
	await mustGit(repoPath, ["init", "-q", "-b", "main"]);
	await mustGit(repoPath, ["add", "README.md"]);
	await mustGit(repoPath, [...gitIdentity, "commit", "-q", "-m", "initial"]);

	const dbPath = join(root, "nightshift.db");
	const db = createDb({ DATABASE_URL: `file:${dbPath}` });
	await migrateDb(db);
	return {
		root,
		repoPath,
		dataDir: join(root, "data"),
		dbPath,
		db,
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

export async function commitFile(repoPath: string, name: string) {
	await writeFile(join(repoPath, name), `${name}\n`);
	await mustGit(repoPath, ["add", name]);
	await mustGit(repoPath, [...gitIdentity, "commit", "-q", "-m", name]);
}

export async function mustGit(cwd: string, args: string[]): Promise<string> {
	const result = await git(cwd, args);
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	}
	return result.stdout;
}

/** An async queue that a test feeds by hand. */
class Channel<T> {
	private items: T[] = [];
	private closed = false;
	private wake: (() => void) | null = null;

	push(item: T) {
		if (this.closed) return;
		this.items.push(item);
		this.notify();
	}

	close() {
		this.closed = true;
		this.notify();
	}

	private notify() {
		const wake = this.wake;
		this.wake = null;
		wake?.();
	}

	async *[Symbol.asyncIterator](): AsyncGenerator<T> {
		while (true) {
			const item = this.items.shift();
			if (item !== undefined) {
				yield item;
				continue;
			}
			if (this.closed) return;
			await new Promise<void>((resolve) => {
				this.wake = resolve;
			});
		}
	}
}

export type ScriptedSession = {
	input: AgentSessionInput;
	emit(event: AgentEvent): void;
	text(delta: string): void;
	finish(costUsd?: number): void;
	fail(message: string): void;
};

/**
 * A harness the test drives by hand. Each `run` call opens a session the
 * test reaches through `sessions`. Aborting ends the stream with an `error`
 * of kind `aborted`, as the real contract says.
 */
export function scriptedHarness(
	options: {
		/** Emitted at once when a session starts. */
		harnessSessionId?: (index: number) => string;
		/** Ignore the abort signal and never end (a daemon that died). */
		hang?: boolean;
	} = {},
) {
	const sessions: ScriptedSession[] = [];
	const harness: AgentHarness = {
		name: "claude-code",
		run(input) {
			const channel = new Channel<AgentEvent>();
			const index = sessions.length;
			const session: ScriptedSession = {
				input,
				emit: (event) => channel.push(event),
				text: (delta) => channel.push({ type: "text", messageId: "m1", delta }),
				finish: (costUsd) => {
					channel.push({
						type: "finished",
						usage: { inputTokens: 10, outputTokens: 5, costUsd },
					});
					channel.close();
				},
				fail: (message) => {
					channel.push({ type: "error", kind: "harness", message });
					channel.close();
				},
			};
			sessions.push(session);
			const id = options.harnessSessionId?.(index) ?? `harness-${index}`;
			channel.push({ type: "session", sessionId: id, model: input.model });
			if (!options.hang) {
				input.signal.addEventListener(
					"abort",
					() => {
						channel.push({
							type: "error",
							kind: "aborted",
							message: "Aborted by the user.",
						});
						channel.close();
					},
					{ once: true },
				);
			}
			return channel;
		},
	};
	return { harness, sessions };
}

export async function waitFor<T>(
	check: () =>
		| T
		| undefined
		| null
		| false
		| Promise<T | undefined | null | false>,
	{ timeoutMs = 5_000, label = "condition" } = {},
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await check();
		if (value) return value;
		await Bun.sleep(5);
	}
	throw new Error(`Timed out waiting for ${label}`);
}
