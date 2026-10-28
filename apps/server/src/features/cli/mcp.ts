import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	serveTools,
	type TerminalPort,
	terminalTools,
} from "@nightshift/agents";
import type { AppRouterClient } from "@nightshift/api";
import { type ChatSpace, chatRun } from "@nightshift/daemon";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { defaultDaemonUrl } from "./join";

/**
 * `nightshift mcp [--project <id, name or folder>]`: an MCP server on
 * stdio for an agent in a terminal (Claude Code, Codex, …), with the
 * authoring tools of the chat in the flow editor: draw, check and save a
 * flow, start a run, read a run. Add it to Claude Code with
 * `claude mcp add nightshift -- nightshift mcp`.
 *
 * It talks to Night Shift that runs on this computer, over its API, as
 * this computer's owner (a request from this computer gets the local
 * session). It starts no Night Shift of its own and opens no database.
 * When Night Shift does not run, each tool says so.
 *
 * `--daemon <address>`: where Night Shift runs (NIGHTSHIFT_DAEMON_URL,
 * default http://localhost:$PORT). `--ui <address>`: where the links of
 * runs and flows open (NIGHTSHIFT_UI_URL, default the daemon's address,
 * which serves the web UI in the binary).
 */

const NOT_RUNNING =
	"Night Shift is not running on this computer. Start it, then try again.";

const INSTRUCTIONS =
	"Night Shift's flow tools. Night Shift keeps the flows of a project as its own data, not as files: read and save them only with these tools. Write flows as the nightshift-flows skill says. Look names up with list_profiles, list_tools and list_skills: a node names a profile by the device and profile ids that list_profiles gives. To change a flow, start from get_flow and keep the positions and Sections of what you do not change. Group a flow of more than about six nodes into Sections, one per phase. Check a flow with check_flow, then save it with save_flow. Start a saved flow with start_run. The tools work in the project of the folder you work in, or the one you name in `project` (list_projects).";

export type McpOptions = {
	daemon: string;
	ui: string;
	project: string | null;
	folder: string;
};

/** `mcp`'s flags over the environment. Null: show the usage. */
export function mcpOptions(
	argv: string[],
	env: Record<string, string | undefined>,
	cwd: string,
): McpOptions | null {
	const args = [...argv];
	let daemon = defaultDaemonUrl(env);
	let ui: string | null = env.NIGHTSHIFT_UI_URL ?? null;
	let project: string | null = null;
	while (args.length > 0) {
		const arg = args.shift() as string;
		const value = args[0];
		if (arg === "--daemon" && value) daemon = args.shift() as string;
		else if (arg === "--ui" && value) ui = args.shift() as string;
		else if (arg === "--project" && value) {
			const named = args.shift() as string;
			// A folder becomes absolute; an id or a name stays as it is.
			project = existsSync(resolve(cwd, named)) ? resolve(cwd, named) : named;
		} else return null;
	}
	const base = (url: string) => url.replace(/\/+$/, "");
	return {
		daemon: base(daemon),
		ui: base(ui ?? daemon),
		project,
		folder: cwd,
	};
}

/** A daemon that does not answer, in plain words; any other error as it is. */
async function guard<T>(
	client: AppRouterClient,
	call: () => Promise<T>,
): Promise<T> {
	try {
		return await call();
	} catch (error) {
		if (error instanceof ORPCError) throw new Error(error.message);
		const up = await client.healthCheck().then(
			() => true,
			() => false,
		);
		if (!up) throw new Error(NOT_RUNNING);
		throw error;
	}
}

/** The terminal tools' port over the API of Night Shift on this computer. */
export function apiPort(
	client: AppRouterClient,
	options: Pick<McpOptions, "ui">,
): TerminalPort {
	const g = <T>(call: () => Promise<T>) => guard(client, call);
	type Harness = Parameters<
		AppRouterClient["harnesses"]["skills"]
	>[0]["harness"];
	return {
		projects: () =>
			g(async () =>
				(await client.projects.list()).map((p) => ({
					id: p.id,
					name: p.name,
					path: p.repoPath,
				})),
			),
		flows: (projectId) => g(() => client.flows.map({ projectId })),
		// Each Device's profiles a node may name, with this computer's settings.
		profiles: (projectId) =>
			g(async () => {
				const [devices, mine] = await Promise.all([
					client.runs.devices({ projectId }),
					client.profiles.list(),
				]);
				const own = new Map(mine.map((p) => [p.id, p]));
				return devices.flatMap((device) =>
					(device.profiles ?? []).map((choice) => {
						const listed = {
							device: device.deviceId,
							profile: choice.id,
							name: choice.name,
							deviceName: device.name,
							kind: choice.kind,
						};
						const p = device.thisDevice ? own.get(choice.id) : undefined;
						if (!p) return listed;
						const description = p.description ?? null;
						if (!("harness" in p)) {
							return {
								...listed,
								decider: p.decider,
								...(p.model ? { model: p.model } : {}),
								description,
							};
						}
						return {
							...listed,
							harness: p.harness,
							model: p.model,
							description,
						};
					}),
				);
			}),
		tools: () =>
			g(async () => {
				const [clis, connections] = await Promise.all([
					client.cliTools.list(),
					client.connections.list(),
				]);
				return {
					clis: clis.map((t) => ({ name: t.name, description: t.description })),
					connections: connections.connections.map((c) => ({
						name: c.name,
						description: c.description,
					})),
				};
			}),
		// The skills of every harness the profiles use: one name once.
		skills: (projectId) =>
			g(async () => {
				const profiles = await client.profiles.list();
				const harnesses = [
					...new Set<Harness>(
						profiles.flatMap((p) =>
							"harness" in p ? [p.harness as Harness] : [],
						),
					),
				];
				const lists = await Promise.all(
					(harnesses.length > 0
						? harnesses
						: (["claude-code"] as Harness[])
					).map((harness) => client.harnesses.skills({ harness, projectId })),
				);
				const byName = new Map(
					lists.flat().map((skill) => [skill.name, skill] as const),
				);
				return [...byName.values()].sort(
					(a, b) =>
						Number(a.source !== "project") - Number(b.source !== "project"),
				);
			}),
		saveFlow: (projectId, name, flow) =>
			g(() => client.flows.save({ projectId, name, flow })),
		startRun: (projectId, flowName, inputs) =>
			g(async () => {
				const run = await client.runs.start({ projectId, flowName, inputs });
				return { id: run.id, status: run.status };
			}),
		runs: (projectId, limit) =>
			g(async () =>
				(await client.runs.list({ projectId, limit })).map((run) => ({
					id: run.id,
					flowName: run.flowName,
					title: run.title,
					status: run.status,
					reason: run.reason,
					createdAt: run.createdAt,
				})),
			),
		run: (projectId, runId) =>
			g(async () => {
				let flowName: string | null = null;
				const space: ChatSpace = {
					flowMap: (id) => client.flows.map({ projectId: id }),
					getRun: async (id) => {
						const detail = await client.runs.get({ runId: id });
						flowName = detail.flowName;
						return detail;
					},
					watchRun: (id, watch) =>
						streamOf(() =>
							client.runs.watch({ runId: id }, { signal: watch?.signal }),
						),
				};
				const run = await chatRun(space, projectId, runId, {
					signal: AbortSignal.timeout(15_000),
				});
				return run ? { run, flowName } : null;
			}),
		runLink: (runId) => `${options.ui}/runs/${encodeURIComponent(runId)}`,
		flowLink: (projectId, name) =>
			`${options.ui}/projects/${encodeURIComponent(projectId)}/flows/${encodeURIComponent(name)}`,
	};
}

/** An async iterable of a stream the call opens. */
async function* streamOf<T>(
	open: () => Promise<AsyncIterable<T>>,
): AsyncGenerator<T> {
	yield* await open();
}

export async function mcpCommand(argv: string[], program: string) {
	const options = mcpOptions(argv, process.env, process.cwd());
	if (!options) {
		console.error(
			`Usage: ${program} [--project <id, name or folder>] [--daemon <address>] [--ui <address>]\nServes Night Shift's flow tools to an agent in a terminal, over MCP on stdio.\nAdd it to Claude Code: claude mcp add nightshift -- ${program}`,
		);
		process.exit(2);
	}
	const client: AppRouterClient = createORPCClient(
		new RPCLink({ url: `${options.daemon}/rpc` }),
	);
	await serveTools(
		terminalTools(apiPort(client, options), {
			project: options.project,
			folder: options.folder,
		}),
		{ name: "nightshift", version: "1", instructions: INSTRUCTIONS },
	);
}
