import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	serveTools,
	type TerminalPort,
	terminalResources,
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
 * authoring tools of the chat in the flow editor (draw, check and save a
 * flow, start a run) and the run side of a night: list, read and stop
 * runs, the Gates that wait and their answers, and the digest; and search
 * and read the project's knowledge on this computer. Add it to
 * Claude Code with
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
	"Night Shift's tools: build flows, and drive the runs of a night. Night Shift keeps the flows of a project as its own data, not as files: read and save them only with these tools. Write flows as the nightshift-flows skill says. Look names up with list_profiles, list_tools and list_skills: a node names a profile by the device and profile ids that list_profiles gives. To change a flow, start from get_flow and keep the positions and Sections of what you do not change. Group a flow of more than about six nodes into Sections, one per phase. Check a flow with check_flow, then save it with save_flow. Start a saved flow with start_run. Follow runs with list_runs and get_run, and stop one with stop_run. A Gate waits for a person: needs_me lists the Gates that wait, with their questions and options. Answer one with answer_gate only with the option the person chose. get_digest says what happened since a time. search_knowledge finds files in the project's knowledge by keyword, and by meaning when this computer can: the wiki, pages and notes besides the code. read_knowledge reads one of them, and each file is a resource too. The tools work in the project of the folder you work in, or the one you name in `project` (list_projects).";

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
					clis: clis.map((t) => ({
						name: t.name,
						description: t.description,
						program: t.program,
						signsIn: t.login !== null,
					})),
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
		runs: (projectId, { limit, statuses }) =>
			g(async () =>
				(await client.runs.list({ projectId, limit, statuses })).map((run) => ({
					id: run.id,
					flowName: run.flowName,
					title: run.title,
					status: run.status,
					reason: run.reason,
					createdAt: run.createdAt,
					endedAt: run.endedAt,
					cost: costOf(run),
					prUrl: run.metrics?.prUrl ?? null,
				})),
			),
		run: (projectId, runId) =>
			g(async () => {
				const seen: {
					detail?: Awaited<ReturnType<AppRouterClient["runs"]["get"]>>;
				} = {};
				const space: ChatSpace = {
					flows: { map: (id) => client.flows.map({ projectId: id }) },
					getRun: async (id) => {
						seen.detail = await client.runs.get({ runId: id });
						return seen.detail;
					},
					watchRun: (id, watch) =>
						streamOf(() =>
							client.runs.watch({ runId: id }, { signal: watch?.signal }),
						),
				};
				const run = await chatRun(space, projectId, runId, {
					signal: AbortSignal.timeout(15_000),
				});
				const { detail } = seen;
				if (!run || !detail) return null;
				return {
					run,
					flowName: detail.flowName,
					cost: costOf(detail),
					prUrl: detail.metrics?.prUrl ?? null,
				};
			}),
		stopRun: (runId, when) => g(() => client.runs.stop({ runId, when })),
		gates: () => g(() => client.gates.list()),
		answerGate: (answer) => g(() => client.gates.resolve(answer)),
		digest: (since) =>
			g(() =>
				client.notifications.digest.since(
					since === undefined ? undefined : { since },
				),
			),
		searchKnowledge: (projectId, query, limit) =>
			g(() =>
				client.knowledge.search({ projectId, query, limit, agent: true }),
			),
		knowledgeFiles: async (projectId) =>
			(await g(() => client.knowledge.get({ projectId }))).files,
		readKnowledge: (projectId, path, maxBytes, from) =>
			g(() =>
				client.knowledge.read({
					projectId,
					path,
					maxBytes,
					...(from ? { from } : {}),
					agent: true,
				}),
			),
		runLink: (runId, stepId) =>
			`${options.ui}/runs/${encodeURIComponent(runId)}${stepId ? `?step=${encodeURIComponent(stepId)}` : ""}`,
		flowLink: (projectId, name) =>
			`${options.ui}/projects/${encodeURIComponent(projectId)}/flows/${encodeURIComponent(name)}`,
	};
}

/** A run's cost fields, as the run tools read them. */
function costOf(run: {
	costUsd: number;
	costEstimated: boolean;
	costMissing: number;
	costCalls: number;
	metrics?: { costBasis: "billed" | "estimated" | "unknown" };
}) {
	return {
		usd: run.costUsd,
		estimated: run.costEstimated,
		missing: run.costMissing,
		calls: run.costCalls,
		basis: run.metrics?.costBasis ?? null,
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
			`Usage: ${program} [--project <id, name or folder>] [--daemon <address>] [--ui <address>]\nServes Night Shift's flow and run tools to an agent in a terminal, over MCP on stdio.\nAdd it to Claude Code: claude mcp add nightshift -- ${program}`,
		);
		process.exit(2);
	}
	const client: AppRouterClient = createORPCClient(
		new RPCLink({ url: `${options.daemon}/rpc` }),
	);
	const port = apiPort(client, options);
	const scope = { project: options.project, folder: options.folder };
	await serveTools(terminalTools(port, scope), {
		name: "nightshift",
		version: "1",
		instructions: INSTRUCTIONS,
		// The knowledge files, read as read_knowledge reads them.
		resources: terminalResources(port, scope),
	});
}
