import { flowNameSchema, flowSchema } from "@nightshift/flows";
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
				}),
				z.object({
					projectId: z.string(),
					flow: flowSchema,
					baseRef: z.string().min(1).optional(),
				}),
			]),
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
	flows,
	runs,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
