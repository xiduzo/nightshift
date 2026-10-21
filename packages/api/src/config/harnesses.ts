import {
	ACP_DEFAULT_MODEL,
	deciderViews,
	harnessViews,
	installedSkills,
} from "@nightshift/agents";
import {
	addHarness,
	HARNESS_BIN,
	removeHarness,
	type SettingField,
	type SettingKey,
	saveCustomAgent,
} from "@nightshift/engine";
import {
	agentHarnessSchema,
	customAgentSchema,
	harnessNameSchema,
	isCustomHarness,
} from "@nightshift/flows";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import {
	customAgentViewSchema,
	deciderViewSchema,
	harnessModelsSchema,
	harnessViewSchema,
	installedSkillSchema,
} from "./schemas";

/**
 * The harnesses Agent nodes run on: every TanStack AI harness adapter, and
 * which of them are added on this daemon, then the custom agents (any ACP
 * agent the person added with its command). A harness's path is the setting
 * `<harness>Bin` (Settings API); a custom agent keeps its command. This
 * adds, removes and lists models.
 */
export const harnesses = {
	list: ownerProcedure
		.route({
			summary:
				"Lists the harnesses Agent nodes can run on: the built-in ones, then the custom agents.",
		})
		.output(output(z.array(harnessViewSchema)))
		.handler(({ context }) => {
			const values = context.settings.current();
			const view = context.settings.view();
			return harnessViews({
				added: values.harnesses,
				customAgents: values.customAgents,
				bin: (
					name,
				): { bin: string; setting: SettingKey; source: SettingField } => ({
					bin: values[HARNESS_BIN[name]],
					setting: HARNESS_BIN[name],
					source: view.fields[HARNESS_BIN[name]],
				}),
				profilesOn: (name) =>
					context.profiles
						.list()
						.filter((p) => p.harness === name)
						.map((p) => p.name),
			});
		}),
	/**
	 * Adds a custom agent, or changes one (`previousSlug`). Its slug, the
	 * name flows use, never changes: a flow that names it keeps working.
	 */
	saveCustom: ownerProcedure
		.route({
			summary:
				"Adds a custom agent, or changes one. Its name in flows stays the same.",
		})
		.output(output(customAgentViewSchema))
		.input(
			customAgentSchema.extend({
				previousSlug: customAgentSchema.shape.slug.optional(),
			}),
		)
		.handler(({ context, input }) => {
			const { previousSlug, ...agent } = input;
			return saveCustomAgent(context, agent, previousSlug);
		}),
	add: ownerProcedure
		.route({ summary: "Adds a built-in harness on this computer." })
		.output(output(z.void()))
		.input(z.object({ harness: harnessNameSchema }))
		.handler(({ context, input }) => addHarness(context, input.harness)),
	/** Refused while a profile runs on it. A custom agent is gone after this. */
	remove: ownerProcedure
		.route({
			summary:
				"Removes a harness from this computer, unless a profile runs on it.",
		})
		.output(output(z.void()))
		.input(z.object({ harness: agentHarnessSchema }))
		.handler(({ context, input }) => removeHarness(context, input.harness)),
	/**
	 * The adapter's models, plus what the CLI lists itself. Never throws.
	 * A custom agent offers `default`: any other model it takes is typed.
	 */
	models: ownerProcedure
		.route({
			summary:
				"Lists the models a harness offers: its known models, then what its CLI lists.",
		})
		.output(output(harnessModelsSchema))
		.input(z.object({ harness: agentHarnessSchema }))
		.handler(({ context, input }) =>
			isCustomHarness(input.harness)
				? {
						models: [ACP_DEFAULT_MODEL],
						listed: 0,
						problem: null,
						checkedAt: Date.now(),
					}
				: context.checks.models(
						input.harness,
						context.settings.current()[HARNESS_BIN[input.harness]],
					),
		),
	/**
	 * The skills the harness can run: the project's own (when its folder is
	 * on this computer), then those for every project here. Never throws.
	 */
	skills: ownerProcedure
		.route({
			summary:
				"Lists the skills a harness can run, for a project or for this computer.",
		})
		.output(output(z.array(installedSkillSchema)))
		.input(
			z.object({
				harness: agentHarnessSchema,
				projectId: z.string().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const projects = input.projectId
				? await context.space.listProjects().catch(() => [])
				: [];
			const project = projects.find((p) => p.id === input.projectId);
			return installedSkills(input.harness, {
				projectPath: project?.repoPath ?? null,
			});
		}),
};

/**
 * The decision models Decision nodes pick from, and whether each has its API
 * key. `value` says whether the decider can also make a value (a Value node
 * made by a model), and which chat model it starts on. A decider that lists
 * its models (Ollama: the models pulled on this computer) puts those first.
 */
export const deciders = {
	list: ownerProcedure
		.route({
			summary:
				"Lists the deciders Decision and Value nodes can use, with their models and API keys.",
		})
		.output(output(z.array(deciderViewSchema)))
		.handler(({ context }) =>
			deciderViews((name) => context.connections.secretSource(name)),
		),
};
