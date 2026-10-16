import {
	connectionInputSchema,
	secretNameSchema,
	settingsPatchSchema,
} from "@nightshift/engine";
import type { Engine } from "@nightshift/engine/types";
import {
	cronError,
	describeCron,
	flowNameSchema,
	flowSchema,
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

const HARNESS_BIN = {
	"claude-code": "claudeBin",
	opencode: "opencodeBin",
	codex: "codexBin",
} as const;

const checkTarget = z.enum(["claude-code", "opencode", "codex", "github"]);

/** The flows, by project, whose Agent nodes name each connection. */
async function connectionUse(
	engine: Engine,
): Promise<
	Map<string, { projectId: string; projectName: string; flowName: string }[]>
> {
	const use = new Map<
		string,
		{ projectId: string; projectName: string; flowName: string }[]
	>();
	for (const project of await engine.listProjects()) {
		const files = await engine.listFlows(project.id).catch(() => []);
		for (const file of files) {
			const loaded = await engine
				.getFlow(project.id, file.name)
				.catch(() => null);
			const names = new Set(
				(loaded?.flow?.nodes ?? []).flatMap((n) =>
					n.type === "agent" ? (n.connections ?? []) : [],
				),
			);
			for (const name of names) {
				use.set(name, [
					...(use.get(name) ?? []),
					{
						projectId: project.id,
						projectName: project.name,
						flowName: file.name,
					},
				]);
			}
		}
	}
	return use;
}

/** The CLIs Night Shift runs (harnesses, gh) and the MCP servers Agent nodes name. */
const connections = {
	list: publicProcedure.handler(async ({ context }) => {
		const use = await connectionUse(context.engine);
		return {
			connections: context.connections.list().map((c) => ({
				...c,
				usedBy: use.get(c.name) ?? [],
			})),
			secrets: context.connections.secrets(),
		};
	}),
	/** Runs `--version` and the login check of one CLI. Read-only. */
	check: publicProcedure
		.input(z.object({ target: checkTarget }))
		.handler(({ context, input }) => {
			const values = context.settings.current();
			return input.target === "github"
				? context.checks.github(values.ghBin)
				: context.checks.harness(
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
				throw new Error(`A connection named "${connection.name}" exists.`);
			}
			const saved = await context.connections.save(connection);
			if (previousName && previousName !== connection.name) {
				await context.connections.remove(previousName);
			}
			return saved;
		}),
	remove: publicProcedure
		.input(z.object({ name: z.string() }))
		.handler(({ context, input }) => context.connections.remove(input.name)),
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
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
