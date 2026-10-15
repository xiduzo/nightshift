import type { RouterClient } from "@orpc/server";
import { z } from "zod";

import { publicProcedure } from "../index";

// Local single-user mode: procedures are public until the local auto-session exists.

const permissionMode = z.enum([
	"default",
	"acceptEdits",
	"bypassPermissions",
	"plan",
]);
const effort = z.enum(["low", "medium", "high", "xhigh", "max"]);

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

const runs = {
	list: publicProcedure
		.input(z.object({ projectId: z.string().optional() }).optional())
		.handler(({ context, input }) => context.engine.listRuns(input)),
	get: publicProcedure
		.input(z.object({ runId: z.string() }))
		.handler(({ context, input }) => context.engine.getRun(input.runId)),
	start: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				prompt: z.string().min(1),
				model: z.string().min(1),
				permissionMode,
				effort: effort.optional(),
				baseRef: z.string().min(1).optional(),
			}),
		)
		.handler(({ context, input }) => context.engine.startRun(input)),
	stop: publicProcedure
		.input(z.object({ runId: z.string() }))
		.handler(({ context, input }) => context.engine.stopRun(input.runId)),
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

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	projects,
	runs,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
