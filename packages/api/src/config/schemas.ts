import type {
	CliCheck,
	CliToolCheck,
	DeciderView,
	HarnessModels,
	HarnessView,
	InstalledSkill,
	McpTestResult,
	McpToolInfo,
} from "@nightshift/agents";
import {
	type CliTool,
	type Connection,
	cliToolGitSchema,
	type FlowRef,
	type ProfileView,
	type SecretSource,
	type SecretView,
	type SettingField,
	type SettingKey,
	settingsSchema,
} from "@nightshift/engine";
import {
	agentHarnessSchema,
	agentProfileSchema,
	type CustomAgent,
	customAgentSchema,
	deciderNameSchema,
	loginSchema,
	mcpServerSchema,
} from "@nightshift/flows";
import { z } from "zod";

import type { Context } from "../context";
import { exact } from "../output";

/**
 * The output schemas of this computer's configuration: settings,
 * harnesses and deciders, profiles, connections and CLI tools.
 */

const settingFieldSchema = exact<SettingField>()(
	z.object({
		source: z.enum(["saved", "env", "default"]),
		default: z.unknown(),
		/** The environment variable this setting falls back to. */
		env: z.string().optional(),
		/** Its value, when it is set and valid. */
		envValue: z.unknown().optional(),
		/** Why the setting cannot change here. */
		locked: z.string().optional(),
	}),
);

const daemonSchema = exact<Context["daemon"]>()(
	z.object({
		dataDir: z.string(),
		device: z.object({ id: z.string(), name: z.string(), ownerId: z.string() }),
		/** `since` is epoch ms. */
		lease: z.object({
			host: z.string(),
			pid: z.number(),
			epoch: z.number(),
			since: z.number(),
		}),
	}),
);

/** Each setting's value and where it comes from, and facts about this daemon. */
export const settingsViewSchema = z.object({
	values: settingsSchema,
	fields: z.record(settingsSchema.keyof(), settingFieldSchema),
	daemon: daemonSchema,
});

/** A flow file of a project of the Space that names something. */
const flowRefSchema = exact<FlowRef>()(
	z.object({
		projectId: z.string(),
		projectName: z.string(),
		flowName: z.string(),
	}),
);

const secretSourceSchema = exact<SecretSource>()(
	z.enum(["keychain", "env", "missing"]),
);

/** A `${NAME}` secret the connections or Command nodes use. Its value never comes back. */
const secretViewSchema = exact<SecretView>()(
	z.object({
		name: z.string(),
		saved: z.boolean(),
		inEnv: z.boolean(),
		/** The connections that reference it. */
		usedBy: z.array(z.string()),
		/** When a value was last saved through Night Shift (epoch ms). Null: not known, or never. */
		setAt: z.number().nullable(),
		/** When Night Shift last read it to use it (epoch ms), to the minute. Null: never. */
		usedAt: z.number().nullable(),
	}),
);

/** An MCP server that Agent and Tool nodes name. */
export const connectionSchema = exact<Connection>()(
	z.object({
		name: z.string(),
		description: z.string().nullable(),
		server: mcpServerSchema,
		/** The `${NAME}` references in its env values and headers. */
		variables: z.array(
			z.object({ name: z.string(), source: secretSourceSchema }),
		),
		updatedAt: z.number(),
	}),
);

export const connectionListSchema = z.object({
	connections: z.array(
		connectionSchema.extend({
			/** The flows that name it. */
			usedBy: z.array(flowRefSchema),
			/** The profiles that name it. */
			profiles: z.array(z.string()),
		}),
	),
	secrets: z.array(
		secretViewSchema.extend({
			/** The flows whose Command nodes name it. */
			flows: z.array(flowRefSchema),
		}),
	),
});

/** A CLI on this computer: where it is, its version and its login. */
export const cliCheckSchema = exact<CliCheck>()(
	z.object({
		bin: z.string(),
		/** Null when it is not there. */
		path: z.string().nullable(),
		version: z.string().nullable(),
		account: z.string().nullable(),
		facts: z.array(z.object({ label: z.string(), value: z.string() })),
		/** Why it cannot run Night Shift's sessions. Null when it can. */
		problem: z.string().nullable(),
		checkedAt: z.number(),
	}),
);

export const cliToolCheckSchema = exact<CliToolCheck>()(
	cliCheckSchema.extend({
		/** The help the agents read. */
		help: z.string().nullable(),
	}),
);

const mcpToolInfoSchema = exact<McpToolInfo>()(
	z.object({
		name: z.string(),
		description: z.string().nullable(),
		inputSchema: z.record(z.string(), z.unknown()),
	}),
);

/** What connecting to an MCP server found. */
export const mcpTestResultSchema = exact<McpTestResult>()(
	z.object({
		ok: z.boolean(),
		server: z.object({ name: z.string(), version: z.string() }).nullable(),
		tools: z.array(mcpToolInfoSchema),
		error: z.string().nullable(),
		ms: z.number(),
	}),
);

export const mcpToolsSchema = z.object({
	ok: z.boolean(),
	tools: z.array(mcpToolInfoSchema),
	/** Why the connection could not be reached. Null when it was. */
	error: z.string().nullable(),
});

/** A program on this computer that the agents may run. */
export const cliToolSchema = exact<CliTool>()(
	z.object({
		name: z.string(),
		program: z.string().nullable(),
		description: z.string().nullable(),
		login: loginSchema.nullable(),
		git: cliToolGitSchema.nullable(),
		updatedAt: z.number(),
	}),
);

export const cliToolListSchema = z.array(
	cliToolSchema.extend({
		usedBy: z.array(flowRefSchema),
		profiles: z.array(z.string()),
	}),
);

/** A custom agent: any ACP agent, by its command. */
export const customAgentViewSchema = exact<CustomAgent>()(customAgentSchema);

/** A harness an Agent node can run on: built-in or a custom agent. */
export const harnessViewSchema = exact<HarnessView<SettingKey, SettingField>>()(
	z.object({
		name: agentHarnessSchema,
		label: z.string(),
		initials: z.string(),
		pkg: z.string(),
		note: z.string(),
		offMachine: z.string(),
		defaultModel: z.string(),
		models: z.array(z.string()),
		/** The command that lists the CLI's own models. */
		listing: z.string().nullable(),
		added: z.boolean(),
		bin: z.string(),
		/** The setting that holds its executable. Null for a custom agent. */
		binSetting: settingsSchema.keyof().nullable(),
		binSource: settingFieldSchema.nullable(),
		/** The profiles that run on it. */
		profiles: z.array(z.string()),
		custom: customAgentSchema.nullable(),
	}),
);

export const harnessModelsSchema = exact<HarnessModels>()(
	z.object({
		/** The adapter's models, then the ones only the CLI listed. */
		models: z.array(z.string()),
		listed: z.number(),
		problem: z.string().nullable(),
		checkedAt: z.number(),
	}),
);

export const installedSkillSchema = exact<InstalledSkill>()(
	z.object({
		name: z.string(),
		description: z.string().nullable(),
		source: z.enum(["project", "computer"]),
	}),
);

/** A decider that Decision and Value nodes pick, and whether it has its API key. */
export const deciderViewSchema = exact<DeciderView<SecretSource>>()(
	z.object({
		name: deciderNameSchema,
		label: z.string(),
		pkg: z.string(),
		models: z.array(z.string()),
		listed: z.number(),
		listProblem: z.string().nullable(),
		defaultModel: z.string(),
		apiKey: z.string().nullable(),
		apiKeySource: secretSourceSchema.nullable(),
		value: z
			.object({ defaultModel: z.string(), models: z.array(z.string()) })
			.nullable(),
	}),
);

/** An Agent Profile: a harness, a model and its tools under one name. */
export const profileViewSchema = exact<ProfileView>()(
	agentProfileSchema.extend({ updatedAt: z.number() }),
);

export const profileListSchema = z.array(
	profileViewSchema.extend({
		/** The Agent nodes that name it, by flow. */
		usedBy: z.array(flowRefSchema.extend({ nodeIds: z.array(z.string()) })),
	}),
);
