import type {
	CliCheck,
	CliToolCheck,
	DeciderModels,
	DeciderView,
	HarnessModels,
	HarnessView,
	InstalledSkill,
	McpTestResult,
	McpToolInfo,
} from "@nightshift/agents";
import type {
	DeviceProfile,
	FlowRef,
	OllamaModel,
	OllamaStatus,
	SignInResult,
} from "@nightshift/engine";
import type {
	AgentSetupJob,
	AgentSetupStatus,
	AgentSetupView,
	DeciderSetupJob,
	DeciderSetupStatus,
} from "@nightshift/engine/agent-setup";
import {
	type CliTool,
	type Connection,
	cliToolGitSchema,
	type ProfileView,
	type SecretScope,
	type SecretSource,
	type SecretView,
	type SettingField,
	type SettingKey,
	settingsSchema,
} from "@nightshift/engine/device-config";
import {
	agentHarnessSchema,
	agentProfileSchema,
	type CustomAgent,
	customAgentSchema,
	deciderNameSchema,
	harnessNameSchema,
	loginSchema,
	mcpServerSchema,
	modelProfileSchema,
	permissionModeSchema,
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
	z.enum(["personal", "keychain", "env", "missing"]),
);

/** Where a saved secret lives (ADR 13): this computer only, or the Person's, on each of their computers. */
export const secretScopeSchema = exact<SecretScope>()(
	z.enum(["computer", "personal"]),
);

/** A `${NAME}` secret the connections or Command nodes use. Its value never comes back. */
const secretViewSchema = exact<SecretView>()(
	z.object({
		name: z.string(),
		/** Where its saved value lives. A name saved nowhere is "computer". */
		scope: secretScopeSchema,
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
			/** The flows that use it: through their nodes, a Model Profile of this computer, or a flow or kit they call. */
			flows: z.array(flowRefSchema),
			/** The CLI tools whose logins read it. */
			tools: z.array(z.string()),
			/** The flows a webhook schedule with this secret starts. */
			webhooks: z.array(flowRefSchema),
		}),
	),
	/** Whether the Person's Personal secrets could be read now. When not, the list has this computer's only. */
	personal: z.enum(["available", "unavailable"]),
});

/** A CLI on this computer: where it is, its version and its login. */
export const cliCheckSchema = exact<CliCheck>()(
	z.object({
		bin: z.string(),
		/** Null when it is not there. */
		path: z.string().nullable(),
		version: z.string().nullable(),
		account: z.string().nullable(),
		signIn: z.enum(["signed_in", "signed_out", "unknown"]),
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
		/** The shape of the tool's structured content, when the server gives one. */
		outputSchema: z.record(z.string(), z.unknown()).optional(),
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
		/** When its login last signed in (epoch ms). Null: never, or it has no sign-in. */
		signedInAt: z.number().nullable(),
		/** Where its login finds its secrets. Null: it has no login. */
		loginState: z
			.object({
				signsInHere: z.boolean(),
				projects: z.array(
					z.object({
						projectId: z.string(),
						projectName: z.string(),
						signedInAt: z.number().nullable(),
					}),
				),
				missing: z.array(z.string()),
			})
			.nullable(),
	}),
);

/** What signing a CLI tool's login in did. */
export const signInResultSchema = exact<SignInResult>()(
	z.object({
		ok: z.boolean(),
		output: z.string(),
		signedInAt: z.number().nullable(),
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
/** The models of a server at an address, or why it did not answer. */
export const deciderModelsSchema = exact<DeciderModels>()(
	z.object({
		models: z.array(z.string()),
		valueModels: z.array(z.string()),
		listed: z.number(),
		problem: z.string().nullable(),
	}),
);

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
		address: z.enum(["required", "optional"]).nullable(),
		probability: z.boolean(),
	}),
);

/**
 * A profile: an Agent Profile (a harness, a model and its tools) or a
 * Model Profile (a decider and its model), with the id that never changes.
 */
export const profileViewSchema = exact<ProfileView>()(
	z.union([
		agentProfileSchema.extend({ id: z.string(), updatedAt: z.number() }),
		modelProfileSchema.extend({ id: z.string(), updatedAt: z.number() }),
	]),
);

/** A profile of a Device, as a Person picks it for a node. */
export const deviceProfileSchema = exact<DeviceProfile>()(
	z.object({
		id: z.string(),
		name: z.string(),
		kind: z.enum(["agent", "model"]),
		permissionMode: permissionModeSchema.optional(),
	}),
);

/**
 * The profiles a flow of a project can use, by Device: every profile of
 * the Person's own Devices, the offered ones of other Persons' Devices.
 * `profiles` is null when this computer cannot tell yet.
 */
export const profileCatalogSchema = z.array(
	z.object({
		deviceId: z.string(),
		name: z.string(),
		thisDevice: z.boolean(),
		/** One of the Person's own Devices; else another Person's, through its Offers. */
		mine: z.boolean(),
		online: z.boolean(),
		profiles: z.array(deviceProfileSchema).nullable(),
	}),
);

const profileUse = {
	id: z.string(),
	updatedAt: z.number(),
	/** The nodes that name it, by flow. */
	usedBy: z.array(flowRefSchema.extend({ nodeIds: z.array(z.string()) })),
};

export const profileListSchema = z.array(
	z.union([
		agentProfileSchema.extend(profileUse),
		modelProfileSchema.extend(profileUse),
	]),
);

/** The Ollama Night Shift uses, for the Settings page. */
export const ollamaStatusSchema = exact<OllamaStatus>()(
	z.object({
		/** Null: on this computer. Else the host name of its address. */
		where: z.string().nullable(),
		/** Who chose the address: the owner's setting, the environment, or neither. */
		from: z.enum(["setting", "env", "local"]),
		/** Whether Night Shift runs this Ollama itself. */
		started: z.boolean(),
		/** Whether an Ollama program is on this computer. */
		installed: z.boolean(),
		/** Whether Ollama answers now. */
		answers: z.boolean(),
		/** The model asked about: the embedding model of search by meaning, unless another is named. */
		model: z.string(),
		/** Whether this Ollama has that model. */
		hasModel: z.boolean(),
		/** The download of the model, while it runs or when it failed. */
		download: z
			.object({
				percent: z.number(),
				running: z.boolean(),
				error: z.string().nullable(),
			})
			.nullable(),
		/** The secrets the headers name that have no value. */
		missingSecrets: z.array(z.string()),
	}),
);

/** A model the Ollama has. */
export const ollamaModelSchema = exact<OllamaModel>()(
	z.object({
		name: z.string(),
		size: z.number(),
		/** Whether it makes embeddings. Null: this Ollama does not say. */
		embedding: z.boolean().nullable(),
	}),
);

/** The state of the guided setup of one agent: the screen polls it. */
const agentSetupJobSchema = exact<AgentSetupJob>()(
	z.discriminatedUnion("state", [
		z.object({ state: z.literal("idle") }),
		z.object({ state: z.literal("installing"), since: z.number() }),
		z.object({
			state: z.literal("installed"),
			/** Where the CLI is now. */
			path: z.string(),
			at: z.number(),
		}),
		z.object({
			state: z.literal("install-failed"),
			problem: z.string(),
			/** The end of what the installer printed, for the details. */
			output: z.string(),
			at: z.number(),
		}),
		z.object({ state: z.literal("checking"), since: z.number() }),
		z.object({
			state: z.literal("signing-in"),
			/** The sign-in page, once the CLI printed it. */
			url: z.string().nullable(),
			since: z.number(),
		}),
		z.object({
			state: z.literal("code-needed"),
			url: z.string().nullable(),
			since: z.number(),
		}),
		z.object({
			state: z.literal("sign-in-failed"),
			problem: z.string(),
			at: z.number(),
		}),
		z.object({
			state: z.literal("ready"),
			/** The profile on the agent: the one it had, or a new one. */
			profileId: z.string(),
			profileName: z.string(),
			account: z.string().nullable(),
			at: z.number(),
		}),
		z.object({ state: z.literal("cancelled"), at: z.number() }),
	]),
);

/** One agent the guided setup can install and sign in. */
export const agentSetupViewSchema = exact<AgentSetupView>()(
	z.object({
		harness: harnessNameSchema,
		label: z.string(),
		/** Who publishes the CLI. */
		vendor: z.string(),
		/** Where the CLI is on this computer now. Null: not found. */
		path: z.string().nullable(),
		/** The exact command an install runs, and the script it downloads. */
		install: z.object({ command: z.string(), source: z.string() }),
		/** The exact command a sign-in runs. */
		signIn: z.object({ command: z.string() }),
		job: agentSetupJobSchema,
	}),
);

export const agentSetupStatusSchema = exact<AgentSetupStatus>()(
	z.object({
		/** Setup can act here, for this request. */
		available: z.boolean(),
		reason: z.enum(["elsewhere", "container", "platform"]).nullable(),
		/** Why not, for the person. */
		message: z.string().nullable(),
		agents: z.array(agentSetupViewSchema),
	}),
);

/** The state of the setup of a decider: the screen polls it. */
const deciderSetupJobSchema = exact<DeciderSetupJob>()(
	z.discriminatedUnion("state", [
		z.object({ state: z.literal("idle") }),
		z.object({ state: z.literal("installing"), since: z.number() }),
		z.object({
			state: z.literal("install-failed"),
			problem: z.string(),
			/** The end of what Homebrew printed, for the details. */
			output: z.string(),
			at: z.number(),
		}),
		z.object({ state: z.literal("starting"), since: z.number() }),
		z.object({
			state: z.literal("downloading"),
			/** From 0 to 100. */
			percent: z.number(),
			since: z.number(),
		}),
		z.object({
			state: z.literal("failed"),
			problem: z.string(),
			at: z.number(),
		}),
		z.object({
			state: z.literal("ready"),
			/** The decider new Decision nodes start on now. */
			decider: deciderNameSchema,
			/** The Model Profile the setup made or updated. */
			profileId: z.string(),
			profileName: z.string(),
			at: z.number(),
		}),
		z.object({ state: z.literal("cancelled"), at: z.number() }),
	]),
);

/** The setup of a decider on this computer: the choices, and the job. Never a key. */
export const deciderSetupStatusSchema = exact<DeciderSetupStatus>()(
	z.object({
		/** The setup can act here, for this request. */
		available: z.boolean(),
		reason: z.enum(["elsewhere", "container", "platform"]).nullable(),
		/** Why not, for the person. */
		message: z.string().nullable(),
		/** The decider new Decision nodes start on now. `chosen`: the person saved it. */
		current: z.object({ decider: deciderNameSchema, chosen: z.boolean() }),
		local: z.object({
			model: z.string(),
			/** About how big the download of the model is, in bytes. */
			bytes: z.number(),
			/** Null: Ollama on this computer. Else the host name of the one Night Shift uses. */
			where: z.string().nullable(),
			installed: z.boolean(),
			answers: z.boolean(),
			hasModel: z.boolean(),
			/** How Ollama gets on this computer. Null: nothing to install. */
			install: z
				.discriminatedUnion("kind", [
					z.object({
						kind: z.literal("brew"),
						/** The exact command that runs. */
						command: z.string(),
					}),
					z.object({
						kind: z.literal("download"),
						/** Ollama's download page. */
						url: z.string(),
					}),
				])
				.nullable(),
		}),
		typesafe: z.object({
			/** A TypeSafe key is saved, or set in the environment. */
			keySaved: z.boolean(),
			/** Where the person gets a key. */
			keyPage: z.string(),
		}),
		job: deciderSetupJobSchema,
	}),
);
