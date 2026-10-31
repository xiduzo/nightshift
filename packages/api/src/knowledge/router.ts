import { ROLE_REFUSAL } from "@nightshift/auth";
import { KNOWLEDGE_FILES_WARNING, type SpaceEngine } from "@nightshift/engine";
import {
	cronError,
	flowNameSchema,
	isTimeZone,
	knowledgeFoldersOf,
	knowledgeKitsOf,
	knowledgeSourceKind,
	knowledgeSourceOf,
	knowledgeSourceSchema,
	REVIEW_LEARNINGS_KIT,
	type Schedule,
	saveKnowledgeSource,
	scheduleSchema,
	withKnowledgeSourceSchedule,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { Context } from "../context";
import { flowIssueSchema } from "../flows";
import { output } from "../output";
import { permitted, protectedProcedure, refusalError } from "../procedures";
import {
	type KnowledgeView,
	knowledgeHitSchema,
	knowledgeSchema,
	knowledgeTextSchema,
} from "./schemas";

/** How many of the project's latest runs `knowledge.get` reads for each source's last sync. */
const LAST_RUNS = 200;

/** The project's schedules as its file holds them: what a save writes back. */
async function savedSchedules(
	space: SpaceEngine,
	projectId: string,
): Promise<Schedule[]> {
	const list = await space.listSchedules(projectId);
	return list.schedules.map((schedule) => scheduleSchema.parse(schedule));
}

/**
 * The schedules of a project are this computer's owner's to change
 * (`schedules.save`): a source that changes one asks the same.
 */
function refuseUnlessOwner(context: Pick<Context, "access" | "daemon">) {
	if (context.access.session?.user.id !== context.daemon.device.ownerId) {
		throw new ORPCError("FORBIDDEN", {
			message:
				"Only the owner of this computer can change its schedules. Save it without Keep it up to date, or ask the owner.",
		});
	}
}

/** The clock of the person who saves a schedule, such as `Europe/Amsterdam`. */
const timeZoneSchema = z.string().refine(isTimeZone, {
	message: "Choose a time zone such as Europe/Amsterdam.",
});

/** The most of one file `knowledge.read` returns. */
const READ_MAX_BYTES = 1024 * 1024;

/** Refuses a project the Space does not have: cheap, for a search on each key. */
async function knownProject(
	space: { listProjects(): Promise<{ id: string }[]> },
	projectId: string,
): Promise<void> {
	const projects = await space.listProjects();
	if (!projects.some((project) => project.id === projectId)) {
		throw new ORPCError("NOT_FOUND", {
			message: "This Space has no such project.",
		});
	}
}

/**
 * A project's knowledge belongs to its Space (ADR 4): every Member of the
 * Space reads it, on any of its Devices and on its Host. A browser changes
 * it only through flows (the syncs) and the review of learnings.
 */
export const knowledge = {
	/**
	 * The files of the project's knowledge, as its Space lists them (after
	 * a reconcile of this computer's folder), the flows that fill it, and
	 * the learnings that wait for a person.
	 */
	get: protectedProcedure
		.route({
			summary:
				"Lists the files of a project's knowledge in its Space, and the flows of the project that fill it.",
		})
		.output(output(knowledgeSchema))
		.input(z.object({ projectId: z.string() }))
		.handler(async ({ context, input }): Promise<KnowledgeView> => {
			// The project is the Space's: an unknown one refuses here.
			const flows = await context.space.flows.map(input.projectId);
			const { files, proposed, shared } = await context.knowledge.listing(
				input.projectId,
			);
			const [schedules, runs] = await Promise.all([
				context.space
					.listSchedules(input.projectId)
					.then((list) => list.schedules)
					// A project without a copy on this computer lists none here.
					.catch((error: unknown) => {
						if (error instanceof Refusal) return [];
						throw error;
					}),
				context.space.listRuns({
					projectId: input.projectId,
					limit: LAST_RUNS,
				}),
			]);
			const used = Object.entries(flows)
				.map(([flow, parsed]) => ({
					flow,
					kits: parsed ? knowledgeKitsOf(parsed) : [],
				}))
				.sort((a, b) => a.flow.localeCompare(b.flow));
			return {
				files,
				tooLarge: files.length > KNOWLEDGE_FILES_WARNING,
				syncs: used.flatMap(({ flow, kits }) => {
					const fills = kits.filter((kit) => kit !== REVIEW_LEARNINGS_KIT);
					if (fills.length === 0) return [];
					const parsed = flows[flow];
					const schedule = schedules.find(
						(item) => item.flow === flow && item.cron !== undefined,
					);
					const last = runs.find((run) => run.flowName === flow);
					return [
						{
							flow,
							kits: fills,
							source: parsed ? knowledgeSourceOf(parsed) : null,
							schedule: schedule?.cron
								? {
										cron: schedule.cron,
										enabled: schedule.enabled,
										...(schedule.device ? { device: schedule.device } : {}),
									}
								: null,
							lastRun: last
								? {
										id: last.id,
										status: last.status,
										at: last.endedAt ?? last.createdAt,
									}
								: null,
						},
					];
				}),
				proposed,
				reviews: used
					.filter(({ kits }) => kits.includes(REVIEW_LEARNINGS_KIT))
					.map(({ flow }) => flow),
				shared,
			};
		}),
	/**
	 * Adds a source to the project's knowledge, or changes one the page
	 * added (`name`): its flow, which calls the kit with the values given
	 * (`saveKnowledgeSource`), and with `keepUpToDate` its schedule (null
	 * removes it). A source that reads a folder of this computer runs its
	 * schedule here. Saving a flow is for a role that may save flows; a
	 * schedule is this computer's owner's. Returns the flow's name and its
	 * problems.
	 */
	saveSource: permitted({ flow: ["save"] })
		.route({
			summary:
				"Adds a source to a project's knowledge, or changes one: a flow that calls a knowledge kit, and its schedule.",
		})
		.output(
			output(z.object({ name: z.string(), issues: z.array(flowIssueSchema) })),
		)
		.input(
			z.object({
				projectId: z.string(),
				/** The source to change. Unset: a new one. */
				name: flowNameSchema.optional(),
				source: knowledgeSourceSchema,
				/** When it syncs on its own: a cron line. Null: never. Unset: as it was. */
				keepUpToDate: z
					.object({ cron: z.string().trim().min(1) })
					.nullable()
					.optional(),
				timeZone: timeZoneSchema.optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const { space } = context;
			if (input.keepUpToDate !== undefined) refuseUnlessOwner(context);
			const cron = input.keepUpToDate?.cron;
			const problem = cron === undefined ? null : cronError(cron);
			if (problem) {
				throw new ORPCError("BAD_REQUEST", {
					message: `This schedule is not valid: ${problem}`,
				});
			}
			const saved = saveKnowledgeSource({
				source: input.source,
				...(input.name !== undefined ? { name: input.name } : {}),
				flows: await space.flows.map(input.projectId),
			});
			const issues = await space.flows.save(
				input.projectId,
				saved.name,
				saved.flow,
			);
			if (input.keepUpToDate !== undefined) {
				const local = knowledgeSourceKind(input.source.kit).local;
				const schedules = withKnowledgeSourceSchedule(
					await savedSchedules(space, input.projectId),
					saved.name,
					cron === undefined
						? null
						: {
								cron,
								...(local ? { device: context.daemon.device.name } : {}),
							},
				);
				await space.saveSchedules(input.projectId, schedules, input.timeZone);
			}
			return { name: saved.name, issues };
		}),
	/**
	 * Removes a source the page added: its flow and its schedules, and with
	 * `removeFiles` the files of its folder in the knowledge, for every
	 * computer of the Space. A folder another flow fills stays. Removing
	 * files changes the knowledge, so it asks a role that may start runs
	 * (ADR 4). Returns how many files it removed.
	 */
	removeSource: permitted({ flow: ["remove"] })
		.route({
			summary:
				"Removes a source from a project's knowledge: its flow, its schedules and, if asked, its files.",
		})
		.output(output(z.object({ removedFiles: z.number() })))
		.input(
			z.object({
				projectId: z.string(),
				name: flowNameSchema,
				removeFiles: z.boolean(),
			}),
		)
		.handler(async ({ context, input }) => {
			const { space } = context;
			const flows = await space.flows.map(input.projectId);
			const flow = flows[input.name];
			if (!flow || !knowledgeSourceOf(flow)) {
				throw new ORPCError("NOT_FOUND", {
					message: "This project has no such source. It may have been removed.",
				});
			}
			if (
				input.removeFiles &&
				!(await context.access.can({ run: ["start"] }))
			) {
				throw refusalError(ROLE_REFUSAL);
			}
			const schedules = await savedSchedules(space, input.projectId).catch(
				(error: unknown) => {
					if (error instanceof Refusal) return [];
					throw error;
				},
			);
			const kept = schedules.filter((schedule) => schedule.flow !== input.name);
			if (kept.length < schedules.length) {
				refuseUnlessOwner(context);
				await space.saveSchedules(input.projectId, kept);
			}
			let removedFiles = 0;
			if (input.removeFiles) {
				const others = new Set(
					Object.entries(flows).flatMap(([name, other]) =>
						name === input.name || !other ? [] : knowledgeFoldersOf(other),
					),
				);
				for (const folder of knowledgeFoldersOf(flow)) {
					if (others.has(folder)) continue;
					removedFiles += await context.knowledge.removeFolder(
						input.projectId,
						folder,
					);
				}
			}
			await space.flows.remove(input.projectId, input.name);
			return { removedFiles };
		}),
	/**
	 * The files of a project's knowledge on this computer that best match
	 * the words, best first, each with an excerpt. Keyword search (BM25):
	 * every word must match, else some of them. "a phrase" in quotes keeps
	 * its words together, and a word ending in `*` matches as a prefix.
	 */
	search: protectedProcedure
		.route({
			summary:
				"Searches the files of a project's knowledge on this computer by keyword, best match first.",
		})
		.output(output(z.array(knowledgeHitSchema)))
		.input(
			z.object({
				projectId: z.string(),
				query: z.string().max(1000),
				limit: z.number().int().min(1).max(50).optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			await knownProject(context.space, input.projectId);
			return context.knowledgeSearch.search(input.projectId, input.query, {
				...(input.limit !== undefined ? { limit: input.limit } : {}),
			});
		}),
	/**
	 * One file of a project's knowledge, by its path: this computer's copy,
	 * else its content by hash from the Space (its Host). Null: no such file.
	 */
	read: protectedProcedure
		.route({
			summary:
				"Reads one file of a project's knowledge, by its path in the knowledge.",
		})
		.output(output(knowledgeTextSchema.nullable()))
		.input(
			z.object({
				projectId: z.string(),
				path: z.string().min(1).max(1000),
				maxBytes: z.number().int().min(1).max(READ_MAX_BYTES).optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			await knownProject(context.space, input.projectId);
			return context.knowledge.read(
				input.projectId,
				input.path,
				input.maxBytes ?? READ_MAX_BYTES,
			);
		}),
};
