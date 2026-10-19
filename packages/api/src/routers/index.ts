import { DECIDER_ADAPTERS, HARNESS_ADAPTERS } from "@nightshift/agents";
import {
	chooseFolder,
	cliToolInputSchema,
	connectionInputSchema,
	type SettingKey,
	secretNameSchema,
	settingsPatchSchema,
} from "@nightshift/engine";
import type { Engine } from "@nightshift/engine/types";
import {
	agentProfileSchema,
	cronError,
	deciderNameSchema,
	describeCron,
	flowNameSchema,
	flowSchema,
	type HarnessName,
	harnessNameSchema,
	labelSchema,
	nextCronTimes,
	scheduleSchema,
} from "@nightshift/flows";
import type { RouterClient } from "@orpc/server";
import { z } from "zod";

import { publicProcedure } from "../index";

// Local single-user mode: procedures are public until the local auto-session exists.

const projects = {
	list: publicProcedure.handler(({ context }) => context.engine.listProjects()),
	add: publicProcedure
		.input(
			z.object({
				repoPath: z.string().min(1),
				name: z.string().min(1).optional(),
			}),
		)
		.handler(({ context, input }) => context.engine.addProject(input)),
	/** The local and remote branches of the clone, for "Start from". Read-only, no fetch. */
	branches: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.engine.listBranches(input.projectId),
		),
	/** What the folder needs before runs can start in it. Read-only. */
	check: publicProcedure
		.input(z.object({ path: z.string().min(1) }))
		.handler(({ context, input }) => context.projectSetup.check(input.path)),
	/**
	 * The `set-up-git` fix: a repository, a starter `.gitignore` and a first
	 * commit. A name and email go into the repository's own git config.
	 */
	setUpGit: publicProcedure
		.input(
			z.object({
				path: z.string().min(1),
				name: z.string().trim().min(1).optional(),
				email: z.email().optional(),
			}),
		)
		.handler(({ context, input }) => context.projectSetup.setUpGit(input)),
	/** The `install-git` fix: starts the system's installer, or says what to run. */
	installGit: publicProcedure.handler(({ context }) =>
		context.projectSetup.installGit(),
	),
	/** Opens the native folder picker on this Mac. Null when cancelled. */
	chooseFolder: publicProcedure.handler(() =>
		chooseFolder("Choose a project folder to add to Night Shift"),
	),
	remove: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.engine.removeProject(input.projectId),
		),
};

const flowRef = z.object({ projectId: z.string(), name: flowNameSchema });

const flows = {
	list: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) => context.engine.listFlows(input.projectId)),
	get: publicProcedure
		.input(flowRef)
		.handler(({ context, input }) =>
			context.engine.getFlow(input.projectId, input.name),
		),
	/** Saves drafts with errors too. Returns the issues. */
	save: publicProcedure
		.input(flowRef.extend({ flow: flowSchema }))
		.handler(({ context, input }) =>
			context.engine.saveFlow(input.projectId, input.name, input.flow),
		),
	remove: publicProcedure
		.input(flowRef)
		.handler(({ context, input }) =>
			context.engine.deleteFlow(input.projectId, input.name),
		),
};

/** The Needs-you inbox. */
const gates = {
	list: publicProcedure.handler(({ context }) => context.engine.listGates()),
	resolve: publicProcedure
		.input(
			z.object({
				runId: z.string(),
				stepId: z.string(),
				choice: z.string().min(1),
				note: z.string().optional(),
			}),
		)
		.handler(({ context, input }) => context.engine.resolveGate(input)),
};

/** `.nightshift/schedules.json`: runs the daemon starts on a cron line. */
const schedules = {
	list: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.engine.listSchedules(input.projectId),
		),
	/** Replaces the whole file. Saves schedules with problems too. Returns the issues. */
	save: publicProcedure
		.input(
			z.object({ projectId: z.string(), schedules: z.array(scheduleSchema) }),
		)
		.handler(({ context, input }) =>
			context.engine.saveSchedules(input.projectId, input.schedules),
		),
	/** The next times of a cron line on the daemon's clock, and how it reads. */
	preview: publicProcedure
		.input(
			z.object({
				cron: z.string(),
				count: z.number().int().min(1).max(10).optional(),
			}),
		)
		.handler(({ input }) => {
			const error = cronError(input.cron);
			return {
				error,
				description: error ? null : describeCron(input.cron),
				times: error
					? []
					: nextCronTimes(input.cron, Date.now(), input.count ?? 3),
			};
		}),
};

const runs = {
	list: publicProcedure
		.input(z.object({ projectId: z.string().optional() }).optional())
		.handler(({ context, input }) => context.engine.listRuns(input)),
	get: publicProcedure
		.input(z.object({ runId: z.string() }))
		.handler(({ context, input }) => context.engine.getRun(input.runId)),
	/** Starts a flow file by name, or a flow given inline (a quick run). */
	start: publicProcedure
		.input(
			z.union([
				z.object({
					projectId: z.string(),
					flowName: flowNameSchema,
					baseRef: z.string().min(1).optional(),
					stopAt: z.number().int().positive().optional(),
					inputs: z.record(z.string(), z.json()).optional(),
				}),
				z.object({
					projectId: z.string(),
					flow: flowSchema,
					baseRef: z.string().min(1).optional(),
					stopAt: z.number().int().positive().optional(),
					inputs: z.record(z.string(), z.json()).optional(),
				}),
			]),
		)
		.handler(({ context, input }) => context.engine.startRun(input)),
	stop: publicProcedure
		.input(
			z.object({
				runId: z.string(),
				when: z.enum(["now", "after-step"]).optional(),
			}),
		)
		.handler(({ context, input }) =>
			context.engine.stopRun(input.runId, { when: input.when }),
		),
	resume: publicProcedure
		.input(
			z.object({ runId: z.string(), prompt: z.string().min(1).optional() }),
		)
		.handler(({ context, input }) =>
			context.engine.resumeRun(input.runId, input.prompt),
		),
	/** Live transcript and status over SSE. Replays from disk first. */
	watch: publicProcedure
		.input(
			z.object({ runId: z.string(), afterSeq: z.number().int().optional() }),
		)
		.handler(async function* ({ context, input, signal }) {
			const controller = new AbortController();
			signal?.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
			yield* context.engine.watchRun(input.runId, {
				signal: controller.signal,
				afterSeq: input.afterSeq,
			});
		}),
	/** Sends a signal to a run whose Wait node waits for it. */
	signal: publicProcedure
		.input(z.object({ runId: z.string(), name: labelSchema }))
		.handler(({ context, input }) =>
			context.engine.signalRun(input.runId, input.name),
		),
};

/** Daemon settings: saved in the database, else the environment, else the default. */
const settings = {
	get: publicProcedure.handler(({ context }) => ({
		...context.settings.view(),
		daemon: context.daemon,
	})),
	/** A value saves it; null forgets it (back to the environment, then the default). */
	save: publicProcedure
		.input(settingsPatchSchema)
		.handler(async ({ context, input }) => ({
			...(await context.settings.save(input)),
			daemon: context.daemon,
		})),
};

/** The setting that holds each harness's executable. */
const HARNESS_BIN = {
	"claude-code": "claudeBin",
	opencode: "opencodeBin",
	codex: "codexBin",
	"grok-build": "grokBin",
	copilot: "copilotBin",
	gemini: "geminiBin",
	cursor: "cursorBin",
} as const satisfies Record<HarnessName, SettingKey>;

const checkTarget = z.enum(harnessNameSchema.options);

type FlowRef = { projectId: string; projectName: string; flowName: string };

/**
 * Who uses what, from every flow of every project: the flows whose Agent
 * or Tool nodes name each connection, whose Agent nodes name each CLI
 * tool, and the Agent nodes that name each profile.
 */
async function flowUse(engine: Engine): Promise<{
	connections: Map<string, FlowRef[]>;
	clis: Map<string, FlowRef[]>;
	profiles: Map<string, (FlowRef & { nodeIds: string[] })[]>;
}> {
	const connections = new Map<string, FlowRef[]>();
	const clis = new Map<string, FlowRef[]>();
	const profiles = new Map<string, (FlowRef & { nodeIds: string[] })[]>();
	for (const project of await engine.listProjects()) {
		const files = await engine.listFlows(project.id).catch(() => []);
		for (const file of files) {
			const loaded = await engine
				.getFlow(project.id, file.name)
				.catch(() => null);
			const ref = {
				projectId: project.id,
				projectName: project.name,
				flowName: file.name,
			};
			const agents = (loaded?.flow?.nodes ?? []).flatMap((n) =>
				n.type === "agent" ? [n] : [],
			);
			const toolConnections = (loaded?.flow?.nodes ?? []).flatMap((n) =>
				n.type === "tool" ? [n.connection] : [],
			);
			for (const name of new Set([
				...agents.flatMap((n) => n.connections ?? []),
				...toolConnections,
			])) {
				connections.set(name, [...(connections.get(name) ?? []), ref]);
			}
			for (const name of new Set(agents.flatMap((n) => n.clis ?? []))) {
				clis.set(name, [...(clis.get(name) ?? []), ref]);
			}
			const byProfile = new Map<string, string[]>();
			for (const node of agents) {
				if (node.profile === undefined) continue;
				byProfile.set(node.profile, [
					...(byProfile.get(node.profile) ?? []),
					node.id,
				]);
			}
			for (const [name, nodeIds] of byProfile) {
				profiles.set(name, [
					...(profiles.get(name) ?? []),
					{ ...ref, nodeIds },
				]);
			}
		}
	}
	return { connections, clis, profiles };
}

/**
 * The harnesses Agent nodes run on: every TanStack AI harness adapter, and
 * which of them are added on this daemon. A harness's path is the setting
 * `<harness>Bin` (Settings API); this adds, removes and lists models.
 */
const harnesses = {
	list: publicProcedure.handler(({ context }) => {
		const values = context.settings.current();
		const view = context.settings.view();
		return harnessNameSchema.options.map((name) => {
			const adapter = HARNESS_ADAPTERS[name];
			return {
				name,
				label: adapter.label,
				initials: adapter.initials,
				pkg: adapter.pkg,
				note: adapter.note,
				offMachine: adapter.offMachine,
				defaultModel: adapter.defaultModel,
				models: [...adapter.models],
				listing: adapter.listing
					? [adapter.bin, ...adapter.listing].join(" ")
					: null,
				added: values.harnesses.includes(name),
				bin: values[HARNESS_BIN[name]],
				binSetting: HARNESS_BIN[name],
				binSource: view.fields[HARNESS_BIN[name]],
				profiles: context.profiles
					.list()
					.filter((p) => p.harness === name)
					.map((p) => p.name),
			};
		});
	}),
	add: publicProcedure
		.input(z.object({ harness: harnessNameSchema }))
		.handler(async ({ context, input }) => {
			const added = context.settings.current().harnesses;
			if (added.includes(input.harness)) return;
			await context.settings.save({ harnesses: [...added, input.harness] });
		}),
	/** Refused while a profile runs on it. */
	remove: publicProcedure
		.input(z.object({ harness: harnessNameSchema }))
		.handler(async ({ context, input }) => {
			const using = context.profiles
				.list()
				.filter((p) => p.harness === input.harness)
				.map((p) => p.name);
			if (using.length > 0) {
				throw new Error(
					`The ${using.length === 1 ? "profile" : "profiles"} ${using.join(", ")} run on ${HARNESS_ADAPTERS[input.harness].label}. Move ${using.length === 1 ? "it" : "them"} to another harness first.`,
				);
			}
			const added = context.settings.current().harnesses;
			await context.settings.save({
				harnesses: added.filter((h) => h !== input.harness),
			});
		}),
	/** The adapter's models, plus what the CLI lists itself. Never throws. */
	models: publicProcedure
		.input(z.object({ harness: harnessNameSchema }))
		.handler(({ context, input }) =>
			context.checks.models(
				input.harness,
				context.settings.current()[HARNESS_BIN[input.harness]],
			),
		),
};

/** Agent Profiles: a harness, a model and its tools under one name. Agent nodes name them. */
const profiles = {
	list: publicProcedure.handler(async ({ context }) => {
		const use = await flowUse(context.engine);
		return context.profiles.list().map((p) => ({
			...p,
			usedBy: use.profiles.get(p.name) ?? [],
		}));
	}),
	save: publicProcedure
		.input(
			agentProfileSchema.extend({
				/** The name it had, when the edit renames it. */
				previousName: z.string().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const { previousName, ...profile } = input;
			const renamed =
				previousName !== undefined && previousName !== profile.name;
			if (
				(previousName === undefined || renamed) &&
				context.profiles.get(profile.name)
			) {
				throw new Error(
					`A profile named "${profile.name}" already exists. Pick another name.`,
				);
			}
			if (renamed) {
				const use = (await flowUse(context.engine)).profiles.get(previousName);
				if (use && use.length > 0) {
					throw new Error(
						`The flows ${use.map((u) => u.flowName).join(", ")} use "${previousName}". Change it there first, or keep the name.`,
					);
				}
			}
			const unknown = profile.connections.filter(
				(name) => !context.connections.get(name),
			);
			if (unknown.length > 0) {
				throw new Error(
					`There is no connection named ${unknown.map((n) => `"${n}"`).join(", ")}. Add it under Agents → Tools first.`,
				);
			}
			const unknownClis = profile.clis.filter(
				(name) => !context.cliTools.get(name),
			);
			if (unknownClis.length > 0) {
				throw new Error(
					`There is no CLI tool named ${unknownClis.map((n) => `"${n}"`).join(", ")}. Add it under Agents → Tools first.`,
				);
			}
			const saved = await context.profiles.save(profile);
			if (renamed) await context.profiles.remove(previousName);
			return saved;
		}),
	/** Flows that name it refuse to start until they name another profile. */
	remove: publicProcedure
		.input(z.object({ name: z.string() }))
		.handler(({ context, input }) => context.profiles.remove(input.name)),
};

/** The CLIs Night Shift runs (harnesses, gh) and the MCP servers Agent nodes name. */
const connections = {
	list: publicProcedure.handler(async ({ context }) => {
		const use = (await flowUse(context.engine)).connections;
		return {
			connections: context.connections.list().map((c) => ({
				...c,
				usedBy: use.get(c.name) ?? [],
				profiles: context.profiles
					.list()
					.filter((p) => p.connections.includes(c.name))
					.map((p) => p.name),
			})),
			secrets: context.connections.secrets(),
		};
	}),
	/** Runs `--version` and the login check of one CLI. Read-only. */
	check: publicProcedure
		.input(z.object({ target: checkTarget }))
		.handler(({ context, input }) => {
			const values = context.settings.current();
			return context.checks.harness(
				input.target,
				values[HARNESS_BIN[input.target]],
			);
		}),
	save: publicProcedure
		.input(
			connectionInputSchema.extend({
				/** The name it had, when the edit renames it. */
				previousName: z.string().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const { previousName, ...connection } = input;
			if (
				previousName !== connection.name &&
				context.connections.get(connection.name)
			) {
				throw new Error(
					`A connection named "${connection.name}" already exists. Pick another name.`,
				);
			}
			const saved = await context.connections.save(connection);
			if (previousName && previousName !== connection.name) {
				await context.connections.remove(previousName);
				for (const p of context.profiles.list()) {
					if (!p.connections.includes(previousName)) continue;
					const { updatedAt: _at, ...profile } = p;
					await context.profiles.save({
						...profile,
						connections: p.connections.map((c) =>
							c === previousName ? connection.name : c,
						),
					});
				}
			}
			return saved;
		}),
	/** Also takes it off the profiles that name it. */
	remove: publicProcedure
		.input(z.object({ name: z.string() }))
		.handler(async ({ context, input }) => {
			await context.connections.remove(input.name);
			for (const p of context.profiles.list()) {
				if (!p.connections.includes(input.name)) continue;
				const { updatedAt: _at, ...profile } = p;
				await context.profiles.save({
					...profile,
					connections: p.connections.filter((c) => c !== input.name),
				});
			}
		}),
	/** Connects to the server, lists its tools, and disconnects. A saved connection or a draft. */
	test: publicProcedure
		.input(
			z.union([
				z.object({ name: z.string() }),
				z.object({ server: connectionInputSchema.shape.server }),
			]),
		)
		.handler(async ({ context, input }) => {
			const { expansion, values } =
				await context.connections.expandForTest(input);
			if (!expansion.ok) {
				return {
					ok: false,
					server: null,
					tools: [],
					error: expansion.message,
					ms: 0,
				};
			}
			const [config] = Object.values(expansion.servers);
			if (!config) throw new Error("Nothing to test.");
			return context.checks.mcp(config, values);
		}),
	/** Saves a secret in the system keychain. The value never comes back. */
	setSecret: publicProcedure
		.input(z.object({ name: secretNameSchema, value: z.string().min(1) }))
		.handler(({ context, input }) =>
			context.connections.setSecret(input.name, input.value),
		),
	removeSecret: publicProcedure
		.input(z.object({ name: secretNameSchema }))
		.handler(({ context, input }) =>
			context.connections.removeSecret(input.name),
		),
	/**
	 * The tools of a saved connection, for a Tool node's inspector: each
	 * tool's name, description and input schema. Same client as `test`.
	 * A connection that cannot be reached answers `ok: false` with why.
	 */
	tools: publicProcedure
		.input(z.object({ name: z.string() }))
		.handler(async ({ context, input }) => {
			const { expansion, values } =
				await context.connections.expandForTest(input);
			if (!expansion.ok) {
				return { ok: false, tools: [], error: expansion.message };
			}
			const [config] = Object.values(expansion.servers);
			if (!config) throw new Error("Nothing to list.");
			const result = await context.checks.mcp(config, values);
			return { ok: result.ok, tools: result.tools, error: result.error };
		}),
};

/**
 * CLI tools: programs on this computer that the agents may run. Agent nodes
 * and profiles name them in `clis`.
 */
const cliTools = {
	list: publicProcedure.handler(async ({ context }) => {
		const use = (await flowUse(context.engine)).clis;
		return context.cliTools.list().map((tool) => ({
			...tool,
			usedBy: use.get(tool.name) ?? [],
			profiles: context.profiles
				.list()
				.filter((p) => p.clis.includes(tool.name))
				.map((p) => p.name),
		}));
	}),
	/** The programs this computer can run by name, to pick one from. */
	programs: publicProcedure.handler(({ context }) => context.checks.programs()),
	/** Where the program is, its version and the help the agents read. Read-only. */
	check: publicProcedure
		.input(z.object({ name: cliToolInputSchema.shape.name }))
		.handler(({ context, input }) => context.checks.cli(input.name)),
	/** Adds a CLI tool, or changes its description. */
	save: publicProcedure
		.input(cliToolInputSchema)
		.handler(({ context, input }) => context.cliTools.save(input)),
	/** Also takes it off the profiles that name it. */
	remove: publicProcedure
		.input(z.object({ name: z.string() }))
		.handler(async ({ context, input }) => {
			await context.cliTools.remove(input.name);
			for (const p of context.profiles.list()) {
				if (!p.clis.includes(input.name)) continue;
				const { updatedAt: _at, ...profile } = p;
				await context.profiles.save({
					...profile,
					clis: p.clis.filter((c) => c !== input.name),
				});
			}
		}),
};

/**
 * The decision models Decision nodes pick from, and whether each has its API
 * key. `value` says whether the decider can also make a value (a Value node
 * made by a model), and which chat model it starts on.
 */
const deciders = {
	list: publicProcedure.handler(({ context }) =>
		deciderNameSchema.options.map((name) => {
			const adapter = DECIDER_ADAPTERS[name];
			return {
				name,
				label: adapter.label,
				pkg: adapter.pkg,
				models: [...adapter.models],
				defaultModel: adapter.defaultModel,
				apiKey: adapter.apiKey,
				apiKeySource: adapter.apiKey
					? context.connections.secretSource(adapter.apiKey)
					: null,
				value: adapter.value
					? { defaultModel: adapter.value.defaultModel }
					: null,
			};
		}),
	),
};

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	projects,
	flows,
	gates,
	schedules,
	runs,
	settings,
	connections,
	cliTools,
	harnesses,
	deciders,
	profiles,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
