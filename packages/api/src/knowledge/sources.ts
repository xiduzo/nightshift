import {
	flowNameSchema,
	isTimeZone,
	knowledgeSourceSchema,
	pageReaderSettingSchema,
} from "@nightshift/flows";
import { z } from "zod";

import { flowIssueSchema } from "../flows";
import { output } from "../output";
import { runSummarySchema } from "../runs";
import { knowledgeProcedure, projectInput, rightsOf } from "./access";
import { linkLookSchema } from "./schemas";

/** The clock of the person who saves a schedule, such as `Europe/Amsterdam`. */
const timeZoneSchema = z.string().refine(isTimeZone, {
	message: "Choose a time zone such as Europe/Amsterdam.",
});

/**
 * The sources that fill a project's knowledge: add, change, remove and
 * sync one, the page reader, and a quick look at links.
 */
export const knowledgeSources = {
	/**
	 * Adds a source to the project's knowledge, or changes one the page
	 * added (`name`): its flow, which calls the kit with the values given
	 * (`saveKnowledgeSource`), and with `keepUpToDate` its schedule (null
	 * removes it). A source that reads a folder of this computer runs its
	 * schedule here. Saving a flow is for a role that may save flows; a
	 * schedule is this computer's owner's. Returns the flow's name and its
	 * problems.
	 */
	saveSource: knowledgeProcedure(
		projectInput.extend({
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
		.route({
			summary:
				"Adds a source to a project's knowledge, or changes one: a flow that calls a knowledge kit, and its schedule.",
		})
		.output(
			output(z.object({ name: z.string(), issues: z.array(flowIssueSchema) })),
		)
		.handler(({ context, input }) => {
			const { projectId, ...source } = input;
			return context.knowledge
				.sources(context.space)
				.save(
					context.actor,
					context.spaceId,
					projectId,
					source,
					rightsOf(context),
				);
		}),
	/**
	 * Removes a source the page added: its flow and its schedules, and with
	 * `removeFiles` the files of its folder in the knowledge, for every
	 * computer of the Space. A folder another flow fills stays. Removing
	 * files changes the knowledge, so it asks a role that may start runs
	 * (ADR 4). Returns how many files it removed.
	 */
	removeSource: knowledgeProcedure(
		projectInput.extend({ name: flowNameSchema, removeFiles: z.boolean() }),
	)
		.route({
			summary:
				"Removes a source from a project's knowledge: its flow, its schedules and, if asked, its files.",
		})
		.output(output(z.object({ removedFiles: z.number() })))
		.handler(({ context, input }) =>
			context.knowledge
				.sources(context.space)
				.remove(
					context.actor,
					context.spaceId,
					input.projectId,
					input.name,
					{ files: input.removeFiles },
					rightsOf(context),
				),
		),
	/**
	 * Syncs a source the page added now: a run of its flow. A folder
	 * source's Subflow runs on the computer that has the folder.
	 */
	syncSource: knowledgeProcedure(projectInput.extend({ name: flowNameSchema }))
		.route({
			summary:
				"Syncs a knowledge source now: starts a run of its flow where its schedule runs it.",
		})
		.output(output(runSummarySchema))
		.handler(({ context, input }) =>
			context.knowledge
				.sources(context.space)
				.sync(
					context.actor,
					context.spaceId,
					input.projectId,
					input.name,
					context.session.user.id,
				),
		),
	/**
	 * Chooses the page reader of the project, on every computer of its Space
	 * (ADR 39): Night Shift's own, Jina Reader or Firecrawl, at its default
	 * address or a self-hosted one, with the name of the secret that holds its
	 * key. It changes how the knowledge fills, so it asks a role that may
	 * start runs (ADR 4). Returns the setting.
	 */
	setReader: knowledgeProcedure(
		projectInput.extend({ reader: pageReaderSettingSchema }),
	)
		.route({
			summary:
				"Chooses the page reader that reads web pages for a project's knowledge, on every computer of its Space.",
		})
		.output(output(pageReaderSettingSchema))
		.handler(({ context, input }) =>
			context.knowledge.setReader(
				context.actor,
				context.spaceId,
				input.projectId,
				input.reader,
			),
		),
	/**
	 * The quick look at links a person tells, before anything is saved: what
	 * each one is (a page, a section, a feed, a file, or why it cannot be
	 * read), its title, and for a page how many pages share its folder. By the
	 * project's page reader, on this computer, within a few seconds per link.
	 */
	look: knowledgeProcedure(
		projectInput.extend({
			urls: z.array(z.string().trim().min(1).max(2000)).min(1).max(20),
		}),
	)
		.route({
			summary:
				"Takes a quick look at web links for a project's knowledge: what each one is, its title, and how many pages share its folder.",
		})
		.output(output(z.array(linkLookSchema)))
		.handler(({ context, input }) =>
			context.knowledge.look(
				context.actor,
				context.spaceId,
				input.projectId,
				input.urls,
			),
		),
};
