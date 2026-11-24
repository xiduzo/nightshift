import {
	KNOWLEDGE_TERMINAL_INSTRUCTION,
	serveTools,
	type TerminalPort,
	terminalResources,
	terminalTools,
} from "@nightshift/agents";
import type { AppRouterClient } from "@nightshift/api";
import { chatRun } from "@nightshift/daemon";
import { runReport } from "@nightshift/engine/run-status";
import { ORPCError } from "@orpc/client";

import { projectArgument, readArgs, required } from "./args";
import { command, defaultDaemonUrl, rpcClient } from "./command";

/**
 * `nightshift mcp [--project <id, name or folder>]`: an MCP server on
 * stdio for an agent in a terminal (Claude Code, Codex, …), with the
 * authoring tools of the chat in the flow editor (draw, check and save a
 * flow, start a run) and the run side of a night: list, read and stop
 * runs, and the Gates that wait and their answers; and search and read
 * the project's knowledge on this computer. Add it to
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

const INSTRUCTIONS = `Night Shift's tools: build flows, and drive the runs of a night. Night Shift keeps the flows of a project as its own data, not as files: read and save them only with these tools. Write flows as the nightshift-flows skill says. Look names up with list_profiles, list_tools and list_skills: a node names a profile by the device and profile ids that list_profiles gives. To change a flow, start from get_flow and keep the positions and Sections of what you do not change. Group a flow of more than about six nodes into Sections, one per phase. Check a flow with check_flow, then save it with save_flow. Start a saved flow with start_run. Follow runs with list_runs and get_run, and stop one with stop_run. A Gate waits for a person: needs_me lists the Gates that wait, with how urgent each is, why it asks, what is done, the recommended option, the question and what each option does. Answer one with answer_gate only with the option the person chose. ${KNOWLEDGE_TERMINAL_INSTRUCTION}`;

export type McpOptions = {
	daemon: string;
	ui: string;
	project: string | null;
	folder: string;
};

/** `mcp`'s flags over the environment. */
export function mcpOptions(
	argv: string[],
	env: Record<string, string | undefined>,
	cwd: string,
): McpOptions {
	let daemon = defaultDaemonUrl(env);
	let ui: string | null = env.NIGHTSHIFT_UI_URL ?? null;
	let project: string | null = null;
	readArgs(argv, {
		values: {
			"--daemon": required((value) => {
				daemon = value;
			}),
			"--ui": required((value) => {
				ui = value;
			}),
			"--project": required((value) => {
				project = projectArgument(cwd, value);
			}),
		},
	});
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
					...(!p.folder ? { folder: false as const } : {}),
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
								// The server only: the secrets of an address stay names.
								...(p.address ? { address: p.address.baseUrl } : {}),
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
		// The place a flow is checked in, from the sources the editor reads.
		place: (projectId, name) =>
			g(async () => {
				const [flows, devices, clis, connections, projects] = await Promise.all(
					[
						client.flows.map({ projectId }),
						client.runs.devices({ projectId }),
						client.cliTools.list(),
						client.connections.list(),
						client.projects.list(),
					],
				);
				return {
					flows,
					name,
					devices,
					connections: connections.connections.map((c) => c.name),
					cliTools: clis.map((t) => ({
						name: t.name,
						program: t.program,
						signsIn: t.login !== null,
					})),
					folder: projects.find((p) => p.id === projectId)?.folder ?? true,
				};
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
					...(run.test ? { test: run.test } : {}),
				})),
			),
		run: (projectId, runId) =>
			g(async () => {
				const detail = await client.runs.get({ runId }).catch(() => null);
				if (!detail || detail.projectId !== projectId) return null;
				const run = await chatRun(
					{
						stepTranscript: (id, stepId, signal) =>
							client.runs.stepTranscript({ runId: id, stepId }, { signal }),
					},
					detail,
					AbortSignal.timeout(15_000),
				);
				return {
					run,
					flowName: detail.flowName,
					cost: costOf(detail),
					prUrl: detail.metrics?.prUrl ?? null,
					report: runReport(detail),
				};
			}),
		stopRun: (runId, when) => g(() => client.runs.stop({ runId, when })),
		gates: () => g(() => client.gates.list()),
		answerGate: (answer) => g(() => client.gates.resolve(answer)),
		searchKnowledge: (projectId, query, limit) =>
			g(() =>
				client.knowledge.search({ projectId, query, limit, agent: true }),
			),
		knowledgeFiles: (projectId) =>
			g(() => client.knowledge.files({ projectId })),
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
	metrics?: {
		costBasis: "billed" | "estimated" | "unknown";
		tokens: { input: number; output: number };
	};
}) {
	const tokens = run.metrics?.tokens;
	const used = tokens ? tokens.input + tokens.output : 0;
	return {
		usd: run.costUsd,
		estimated: run.costEstimated,
		missing: run.costMissing,
		calls: run.costCalls,
		basis: run.metrics?.costBasis ?? null,
		tokens:
			used > 0 && tokens
				? { input: tokens.input, output: tokens.output }
				: null,
	};
}

export const mcpCommand = command({
	name: "mcp",
	help: `  nightshift mcp [--project <project>]     Serve the flow tools to an agent in a terminal
                                            (MCP on stdio). Night Shift must run here.
                                            Claude Code: claude mcp add nightshift -- nightshift mcp`,
	usage: (program) =>
		`Usage: ${program} [--project <id, name or folder>] [--daemon <address>] [--ui <address>]\nServes Night Shift's flow and run tools to an agent in a terminal, over MCP on stdio.\nAdd it to Claude Code: claude mcp add nightshift -- ${program}`,
	// On stdout an agent reads MCP only.
	usageOn: "stderr",
	options: (argv) => mcpOptions(argv, process.env, process.cwd()),
	run: async (options) => {
		const port = apiPort(rpcClient(options.daemon), options);
		const scope = { project: options.project, folder: options.folder };
		await serveTools(terminalTools(port, scope), {
			name: "nightshift",
			version: "1",
			instructions: INSTRUCTIONS,
			// The knowledge files, read as read_knowledge reads them.
			resources: terminalResources(port, scope),
		});
	},
});
