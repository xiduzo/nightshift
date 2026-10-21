import {
	ACP_DEFAULT_MODEL,
	deciderViews,
	HARNESS_ADAPTERS,
	harnessViews,
	installedSkills,
} from "@nightshift/agents";
import {
	HARNESS_BIN,
	type SettingField,
	type SettingKey,
} from "@nightshift/engine";
import {
	agentHarnessSchema,
	type CustomAgent,
	customAgentSchema,
	customAgentSlug,
	harnessNameSchema,
	isCustomHarness,
} from "@nightshift/flows";
import { z } from "zod";

import { ownerProcedure } from "../procedures";

/** The custom agent of that flow name on this daemon, or undefined. */
export function customAgentOf(
	agents: readonly CustomAgent[],
	name: string,
): CustomAgent | undefined {
	return isCustomHarness(name)
		? agents.find((a) => a.slug === customAgentSlug(name))
		: undefined;
}

/**
 * The harnesses Agent nodes run on: every TanStack AI harness adapter, and
 * which of them are added on this daemon, then the custom agents (any ACP
 * agent the person added with its command). A harness's path is the setting
 * `<harness>Bin` (Settings API); a custom agent keeps its command. This
 * adds, removes and lists models.
 */
export const harnesses = {
	list: ownerProcedure.handler(({ context }) => {
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
		.input(
			customAgentSchema.extend({
				previousSlug: customAgentSchema.shape.slug.optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const { previousSlug, ...agent } = input;
			const agents = context.settings.current().customAgents;
			if (previousSlug === undefined) {
				if (agents.some((a) => a.slug === agent.slug)) {
					throw new Error(
						`A custom agent named acp:${agent.slug} already exists. Pick another name.`,
					);
				}
				await context.settings.save({ customAgents: [...agents, agent] });
				return customAgentSchema.parse(agent);
			}
			if (!agents.some((a) => a.slug === previousSlug)) {
				throw new Error("This custom agent was removed. Add it again.");
			}
			const saved = customAgentSchema.parse({ ...agent, slug: previousSlug });
			await context.settings.save({
				customAgents: agents.map((a) => (a.slug === previousSlug ? saved : a)),
			});
			return saved;
		}),
	add: ownerProcedure
		.input(z.object({ harness: harnessNameSchema }))
		.handler(async ({ context, input }) => {
			const added = context.settings.current().harnesses;
			if (added.includes(input.harness)) return;
			await context.settings.save({ harnesses: [...added, input.harness] });
		}),
	/** Refused while a profile runs on it. A custom agent is gone after this. */
	remove: ownerProcedure
		.input(z.object({ harness: agentHarnessSchema }))
		.handler(async ({ context, input }) => {
			const values = context.settings.current();
			const custom = customAgentOf(values.customAgents, input.harness);
			const label = isCustomHarness(input.harness)
				? (custom?.label ?? input.harness)
				: HARNESS_ADAPTERS[input.harness].label;
			const using = context.profiles
				.list()
				.filter((p) => p.harness === input.harness)
				.map((p) => p.name);
			if (using.length > 0) {
				throw new Error(
					`The ${using.length === 1 ? "profile" : "profiles"} ${using.join(", ")} run on ${label}. Move ${using.length === 1 ? "it" : "them"} to another harness first.`,
				);
			}
			if (isCustomHarness(input.harness)) {
				await context.settings.save({
					customAgents: values.customAgents.filter((a) => a !== custom),
				});
				return;
			}
			const name = input.harness;
			const added = values.harnesses;
			await context.settings.save({
				harnesses: added.filter((h) => h !== name),
			});
		}),
	/**
	 * The adapter's models, plus what the CLI lists itself. Never throws.
	 * A custom agent offers `default`: any other model it takes is typed.
	 */
	models: ownerProcedure
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
	list: ownerProcedure.handler(({ context }) =>
		deciderViews((name) => context.connections.secretSource(name)),
	),
};
