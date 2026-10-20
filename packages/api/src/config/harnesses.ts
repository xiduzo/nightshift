import {
	ACP_DEFAULT_MODEL,
	DECIDER_ADAPTERS,
	deciderModels,
	HARNESS_ADAPTERS,
	installedSkills,
} from "@nightshift/agents";
import {
	HARNESS_BIN,
	type SettingField,
	type SettingKey,
} from "@nightshift/engine";
import {
	type AgentHarnessName,
	agentHarnessSchema,
	type CustomAgent,
	customAgentSchema,
	customAgentSlug,
	customHarnessName,
	deciderNameSchema,
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
		const profilesOn = (name: string) =>
			context.profiles
				.list()
				.filter((p) => p.harness === name)
				.map((p) => p.name);
		const builtIn = harnessNameSchema.options.map((name) => {
			const adapter = HARNESS_ADAPTERS[name];
			return {
				name: name as AgentHarnessName,
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
				binSetting: HARNESS_BIN[name] as SettingKey | null,
				binSource: view.fields[HARNESS_BIN[name]] as SettingField | null,
				profiles: profilesOn(name),
				custom: null as CustomAgent | null,
			};
		});
		const custom = values.customAgents.map((agent) => ({
			name: customHarnessName(agent.slug) as AgentHarnessName,
			label: agent.label,
			initials: agent.label.slice(0, 2).toUpperCase(),
			pkg: "@tanstack/ai-acp",
			note: `Model default uses the model ${agent.label} is set to. You can type another model it offers.`,
			offMachine: `Prompts and code go wherever ${agent.label} sends them.`,
			defaultModel: ACP_DEFAULT_MODEL,
			models: [ACP_DEFAULT_MODEL],
			listing: null,
			added: true,
			bin: agent.command,
			binSetting: null,
			binSource: null,
			profiles: profilesOn(customHarnessName(agent.slug)),
			custom: agent,
		}));
		return [...builtIn, ...custom];
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
		Promise.all(
			deciderNameSchema.options.map(async (name) => {
				const adapter = DECIDER_ADAPTERS[name];
				const offered = await deciderModels(name);
				return {
					name,
					label: adapter.label,
					pkg: adapter.pkg,
					models: offered.models,
					listed: offered.listed,
					listProblem: offered.problem,
					defaultModel: adapter.defaultModel,
					apiKey: adapter.apiKey,
					apiKeySource: adapter.apiKey
						? context.connections.secretSource(adapter.apiKey)
						: null,
					value: adapter.value
						? {
								defaultModel: adapter.value.defaultModel,
								models: offered.valueModels,
							}
						: null,
				};
			}),
		),
	),
};
