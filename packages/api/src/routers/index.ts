import { DECIDER_ADAPTERS, HARNESS_ADAPTERS } from "@nightshift/agents";
import { spacesOf } from "@nightshift/auth/spaces";
import {
	chooseFolder,
	cliToolInputSchema,
	connectionInputSchema,
	HARNESS_BIN,
	secretNameSchema,
	settingsPatchSchema,
} from "@nightshift/engine";
import type { SpaceEngine } from "@nightshift/engine/types";
import {
	agentProfileSchema,
	cronError,
	deciderNameSchema,
	describeCron,
	flowNameSchema,
	flowSchema,
	harnessNameSchema,
	labelSchema,
	nextCronTimes,
	scheduleSchema,
} from "@nightshift/flows";
import { ORPCError, type RouterClient } from "@orpc/server";
import { z } from "zod";

import {
	deviceProcedure,
	ownerProcedure,
	permitted,
	protectedProcedure,
	publicProcedure,
} from "../index";

// Every procedure but the health check needs a session in a Space. One
// person on one computer has one without signing in (the local session).
// Runs, Gates and projects are the session's Space's; what changes them
// needs a role that allows it. This computer's own configuration is its
// owner's.

/** The Person's Spaces, and the one the session works in. */
const spaces = {
	/** The personal Space first. `active` is the session's Space. */
	list: protectedProcedure.handler(async ({ context }) => ({
		active: context.spaceId,
		spaces: await spacesOf(context.db, context.session.user.id),
	})),
	/** Every later call works in this Space. */
	switch: protectedProcedure
		.input(z.object({ spaceId: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			await context.setActiveSpace(input.spaceId);
		}),
	/** A new Space with the Person as its owner. Later calls work in it. */
	create: protectedProcedure
		.input(z.object({ name: z.string().trim().min(1).max(60) }))
		.handler(({ context, input }) => context.createSpace(input.name)),
};

const projects = {
	list: protectedProcedure.handler(({ context }) =>
		context.space.listProjects(),
	),
	add: permitted({ project: ["add"] })
		.input(
			z.object({
				repoPath: z.string().min(1),
				name: z.string().min(1).optional(),
			}),
		)
		.handler(({ context, input }) => context.space.addProject(input)),
	/** The local and remote branches of the clone, for "Start from". Read-only, no fetch. */
	branches: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listBranches(input.projectId),
		),
	/** What the folder needs before runs can start in it. Read-only. */
	check: ownerProcedure
		.input(z.object({ path: z.string().min(1) }))
		.handler(({ context, input }) => context.projectSetup.check(input.path)),
	/**
	 * The `set-up-git` fix: a repository, a starter `.gitignore` and a first
	 * commit. A name and email go into the repository's own git config.
	 */
	setUpGit: ownerProcedure
		.input(
			z.object({
				path: z.string().min(1),
				name: z.string().trim().min(1).optional(),
				email: z.email().optional(),
			}),
		)
		.handler(({ context, input }) => context.projectSetup.setUpGit(input)),
	/** The `install-git` fix: starts the system's installer, or says what to run. */
	installGit: ownerProcedure.handler(({ context }) =>
		context.projectSetup.installGit(),
	),
	/** Opens the native folder picker on this Mac. Null when cancelled. */
	chooseFolder: ownerProcedure.handler(() =>
		chooseFolder("Choose a project folder to add to Night Shift"),
	),
	remove: permitted({ project: ["remove"] })
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.removeProject(input.projectId),
		),
	/** A new name, for every Member of the Space. Whoever may add projects may rename them. */
	rename: permitted({ project: ["add"] })
		.input(
			z.object({
				projectId: z.string(),
				name: z.string().trim().min(1).max(100),
			}),
		)
		.handler(({ context, input }) =>
			context.space.renameProject(input.projectId, input.name),
		),
	/** Moves the project, its runs and their history to another Space: `project.move` in both. */
	move: permitted({ project: ["move"] })
		.input(z.object({ projectId: z.string(), spaceId: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			if (!(await context.can({ project: ["move"] }, input.spaceId))) {
				throw new ORPCError("FORBIDDEN", {
					message: "Your role in that Space does not allow this.",
				});
			}
			await context.space.moveProject(input.projectId, input.spaceId);
		}),
};

const flowRef = z.object({ projectId: z.string(), name: flowNameSchema });

const flows = {
	list: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) => context.space.listFlows(input.projectId)),
	get: protectedProcedure
		.input(flowRef)
		.handler(({ context, input }) =>
			context.space.getFlow(input.projectId, input.name),
		),
	/** Saves drafts with errors too. Returns the issues. Writes this computer's Clone: its owner's. */
	save: ownerProcedure
		.input(flowRef.extend({ flow: flowSchema }))
		.handler(({ context, input }) =>
			context.space.saveFlow(input.projectId, input.name, input.flow),
		),
	remove: ownerProcedure
		.input(flowRef)
		.handler(({ context, input }) =>
			context.space.deleteFlow(input.projectId, input.name),
		),
};

/** The Needs-you inbox. */
const gates = {
	list: protectedProcedure.handler(({ context }) => context.space.listGates()),
	resolve: permitted({ gate: ["resolve"] })
		.input(
			z.object({
				runId: z.string(),
				stepId: z.string(),
				choice: z.string().min(1),
				note: z.string().optional(),
			}),
		)
		.handler(({ context, input }) => context.space.resolveGate(input)),
};

/** `.nightshift/schedules.json`: runs the daemon starts on a cron line. */
const schedules = {
	list: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listSchedules(input.projectId),
		),
	/**
	 * Replaces the whole file. Saves schedules with problems too. Returns the
	 * issues. Writes this computer's Clone: its owner's.
	 */
	save: ownerProcedure
		.input(
			z.object({ projectId: z.string(), schedules: z.array(scheduleSchema) }),
		)
		.handler(({ context, input }) =>
			context.space.saveSchedules(input.projectId, input.schedules),
		),
	/** The next times of a cron line on the daemon's clock, and how it reads. */
	preview: protectedProcedure
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
	list: protectedProcedure
		.input(z.object({ projectId: z.string().optional() }).optional())
		.handler(({ context, input }) => context.space.listRuns(input)),
	get: protectedProcedure
		.input(z.object({ runId: z.string() }))
		.handler(({ context, input }) => context.space.getRun(input.runId)),
	/** Starts a flow file by name, or a flow given inline (a quick run). */
	start: permitted({ run: ["start"] })
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
		.handler(({ context, input }) => context.space.startRun(input)),
	stop: permitted({ run: ["stop"] })
		.input(
			z.object({
				runId: z.string(),
				when: z.enum(["now", "after-step"]).optional(),
			}),
		)
		.handler(({ context, input }) =>
			context.space.stopRun(input.runId, { when: input.when }),
		),
	resume: permitted({ run: ["resume"] })
		.input(
			z.object({ runId: z.string(), prompt: z.string().min(1).optional() }),
		)
		.handler(({ context, input }) =>
			context.space.resumeRun(input.runId, input.prompt),
		),
	/** Live transcript and status over SSE. Replays from disk first. */
	watch: protectedProcedure
		.input(
			z.object({ runId: z.string(), afterSeq: z.number().int().optional() }),
		)
		.handler(async function* ({ context, input, signal }) {
			const controller = new AbortController();
			signal?.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
			yield* context.space.watchRun(input.runId, {
				signal: controller.signal,
				afterSeq: input.afterSeq,
			});
		}),
	/** Sends a signal to a run whose Wait node waits for it. */
	signal: permitted({ signal: ["send"] })
		.input(z.object({ runId: z.string(), name: labelSchema }))
		.handler(({ context, input }) =>
			context.space.signalRun(input.runId, input.name),
		),
};

/** Daemon settings: saved in the database, else the environment, else the default. */
const settings = {
	get: ownerProcedure.handler(({ context }) => ({
		...context.settings.view(),
		daemon: context.daemon,
	})),
	/** A value saves it; null forgets it (back to the environment, then the default). */
	save: ownerProcedure
		.input(settingsPatchSchema)
		.handler(async ({ context, input }) => ({
			...(await context.settings.save(input)),
			daemon: context.daemon,
		})),
};

const checkTarget = z.enum(harnessNameSchema.options);

type FlowRef = { projectId: string; projectName: string; flowName: string };

/**
 * Who uses what, from every flow of the Space's projects: the flows whose Agent
 * or Tool nodes name each connection, whose Agent nodes name each CLI
 * tool, and the Agent nodes that name each profile.
 */
async function flowUse(engine: SpaceEngine): Promise<{
	connections: Map<string, FlowRef[]>;
	clis: Map<string, FlowRef[]>;
	profiles: Map<string, (FlowRef & { nodeIds: string[] })[]>;
}> {
	const connections = new Map<string, FlowRef[]>();
	const clis = new Map<string, FlowRef[]>();
	const profiles = new Map<string, (FlowRef & { nodeIds: string[] })[]>();
	for (const project of await engine.listProjects()) {
		const files = await engine.listFlows(project.id).catch(() => []);
		for (const file of files) {
			const loaded = await engine
				.getFlow(project.id, file.name)
				.catch(() => null);
			const ref = {
				projectId: project.id,
				projectName: project.name,
				flowName: file.name,
			};
			const agents = (loaded?.flow?.nodes ?? []).flatMap((n) =>
				n.type === "agent" ? [n] : [],
			);
			const toolConnections = (loaded?.flow?.nodes ?? []).flatMap((n) =>
				n.type === "tool" ? [n.connection] : [],
			);
			for (const name of new Set([
				...agents.flatMap((n) => n.connections ?? []),
				...toolConnections,
			])) {
				connections.set(name, [...(connections.get(name) ?? []), ref]);
			}
			for (const name of new Set(agents.flatMap((n) => n.clis ?? []))) {
				clis.set(name, [...(clis.get(name) ?? []), ref]);
			}
			const byProfile = new Map<string, string[]>();
			for (const node of agents) {
				if (node.profile === undefined) continue;
				byProfile.set(node.profile, [
					...(byProfile.get(node.profile) ?? []),
					node.id,
				]);
			}
			for (const [name, nodeIds] of byProfile) {
				profiles.set(name, [
					...(profiles.get(name) ?? []),
					{ ...ref, nodeIds },
				]);
			}
		}
	}
	return { connections, clis, profiles };
}

/**
 * The harnesses Agent nodes run on: every TanStack AI harness adapter, and
 * which of them are added on this daemon. A harness's path is the setting
 * `<harness>Bin` (Settings API); this adds, removes and lists models.
 */
const harnesses = {
	list: ownerProcedure.handler(({ context }) => {
		const values = context.settings.current();
		const view = context.settings.view();
		return harnessNameSchema.options.map((name) => {
			const adapter = HARNESS_ADAPTERS[name];
			return {
				name,
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
				binSetting: HARNESS_BIN[name],
				binSource: view.fields[HARNESS_BIN[name]],
				profiles: context.profiles
					.list()
					.filter((p) => p.harness === name)
					.map((p) => p.name),
			};
		});
	}),
	add: ownerProcedure
		.input(z.object({ harness: harnessNameSchema }))
		.handler(async ({ context, input }) => {
			const added = context.settings.current().harnesses;
			if (added.includes(input.harness)) return;
			await context.settings.save({ harnesses: [...added, input.harness] });
		}),
	/** Refused while a profile runs on it. */
	remove: ownerProcedure
		.input(z.object({ harness: harnessNameSchema }))
		.handler(async ({ context, input }) => {
			const using = context.profiles
				.list()
				.filter((p) => p.harness === input.harness)
				.map((p) => p.name);
			if (using.length > 0) {
				throw new Error(
					`The ${using.length === 1 ? "profile" : "profiles"} ${using.join(", ")} run on ${HARNESS_ADAPTERS[input.harness].label}. Move ${using.length === 1 ? "it" : "them"} to another harness first.`,
				);
			}
			const added = context.settings.current().harnesses;
			await context.settings.save({
				harnesses: added.filter((h) => h !== input.harness),
			});
		}),
	/** The adapter's models, plus what the CLI lists itself. Never throws. */
	models: ownerProcedure
		.input(z.object({ harness: harnessNameSchema }))
		.handler(({ context, input }) =>
			context.checks.models(
				input.harness,
				context.settings.current()[HARNESS_BIN[input.harness]],
			),
		),
};

/** Agent Profiles: a harness, a model and its tools under one name. Agent nodes name them. */
const profiles = {
	list: ownerProcedure.handler(async ({ context }) => {
		const use = await flowUse(context.space);
		return context.profiles.list().map((p) => ({
			...p,
			usedBy: use.profiles.get(p.name) ?? [],
		}));
	}),
	save: ownerProcedure
		.input(
			agentProfileSchema.extend({
				/** The name it had, when the edit renames it. */
				previousName: z.string().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const { previousName, ...profile } = input;
			const renamed =
				previousName !== undefined && previousName !== profile.name;
			if (
				(previousName === undefined || renamed) &&
				context.profiles.get(profile.name)
			) {
				throw new Error(
					`A profile named "${profile.name}" already exists. Pick another name.`,
				);
			}
			if (renamed) {
				const use = (await flowUse(context.space)).profiles.get(previousName);
				if (use && use.length > 0) {
					throw new Error(
						`The flows ${use.map((u) => u.flowName).join(", ")} use "${previousName}". Change it there first, or keep the name.`,
					);
				}
			}
			const unknown = profile.connections.filter(
				(name) => !context.connections.get(name),
			);
			if (unknown.length > 0) {
				throw new Error(
					`There is no connection named ${unknown.map((n) => `"${n}"`).join(", ")}. Add it under Agents → Tools first.`,
				);
			}
			const unknownClis = profile.clis.filter(
				(name) => !context.cliTools.get(name),
			);
			if (unknownClis.length > 0) {
				throw new Error(
					`There is no CLI tool named ${unknownClis.map((n) => `"${n}"`).join(", ")}. Add it under Agents → Tools first.`,
				);
			}
			const saved = await context.profiles.save(profile);
			if (renamed) await context.profiles.remove(previousName);
			return saved;
		}),
	/** Flows that name it refuse to start until they name another profile. */
	remove: ownerProcedure
		.input(z.object({ name: z.string() }))
		.handler(({ context, input }) => context.profiles.remove(input.name)),
};

/** The CLIs Night Shift runs (harnesses, gh) and the MCP servers Agent nodes name. */
const connections = {
	list: ownerProcedure.handler(async ({ context }) => {
		const use = (await flowUse(context.space)).connections;
		return {
			connections: context.connections.list().map((c) => ({
				...c,
				usedBy: use.get(c.name) ?? [],
				profiles: context.profiles
					.list()
					.filter((p) => p.connections.includes(c.name))
					.map((p) => p.name),
			})),
			secrets: context.connections.secrets(),
		};
	}),
	/** Runs `--version` and the login check of one CLI. Read-only. */
	check: ownerProcedure
		.input(z.object({ target: checkTarget }))
		.handler(({ context, input }) => {
			const values = context.settings.current();
			return context.checks.harness(
				input.target,
				values[HARNESS_BIN[input.target]],
			);
		}),
	save: ownerProcedure
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
				throw new Error(
					`A connection named "${connection.name}" already exists. Pick another name.`,
				);
			}
			const saved = await context.connections.save(connection);
			if (previousName && previousName !== connection.name) {
				await context.connections.remove(previousName);
				for (const p of context.profiles.list()) {
					if (!p.connections.includes(previousName)) continue;
					const { updatedAt: _at, ...profile } = p;
					await context.profiles.save({
						...profile,
						connections: p.connections.map((c) =>
							c === previousName ? connection.name : c,
						),
					});
				}
			}
			return saved;
		}),
	/** Also takes it off the profiles that name it. */
	remove: ownerProcedure
		.input(z.object({ name: z.string() }))
		.handler(async ({ context, input }) => {
			await context.connections.remove(input.name);
			for (const p of context.profiles.list()) {
				if (!p.connections.includes(input.name)) continue;
				const { updatedAt: _at, ...profile } = p;
				await context.profiles.save({
					...profile,
					connections: p.connections.filter((c) => c !== input.name),
				});
			}
		}),
	/** Connects to the server, lists its tools, and disconnects. A saved connection or a draft. */
	test: ownerProcedure
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
	setSecret: ownerProcedure
		.input(z.object({ name: secretNameSchema, value: z.string().min(1) }))
		.handler(({ context, input }) =>
			context.connections.setSecret(input.name, input.value),
		),
	removeSecret: ownerProcedure
		.input(z.object({ name: secretNameSchema }))
		.handler(({ context, input }) =>
			context.connections.removeSecret(input.name),
		),
	/**
	 * The tools of a saved connection, for a Tool node's inspector: each
	 * tool's name, description and input schema. Same client as `test`.
	 * A connection that cannot be reached answers `ok: false` with why.
	 */
	tools: ownerProcedure
		.input(z.object({ name: z.string() }))
		.handler(async ({ context, input }) => {
			const { expansion, values } =
				await context.connections.expandForTest(input);
			if (!expansion.ok) {
				return { ok: false, tools: [], error: expansion.message };
			}
			const [config] = Object.values(expansion.servers);
			if (!config) throw new Error("Nothing to list.");
			const result = await context.checks.mcp(config, values);
			return { ok: result.ok, tools: result.tools, error: result.error };
		}),
};

/**
 * CLI tools: programs on this computer that the agents may run. Agent nodes
 * and profiles name them in `clis`.
 */
const cliTools = {
	list: ownerProcedure.handler(async ({ context }) => {
		const use = (await flowUse(context.space)).clis;
		return context.cliTools.list().map((tool) => ({
			...tool,
			usedBy: use.get(tool.name) ?? [],
			profiles: context.profiles
				.list()
				.filter((p) => p.clis.includes(tool.name))
				.map((p) => p.name),
		}));
	}),
	/** The programs this computer can run by name, to pick one from. */
	programs: ownerProcedure.handler(({ context }) => context.checks.programs()),
	/** Where the program is, its version and the help the agents read. Read-only. */
	check: ownerProcedure
		.input(z.object({ name: cliToolInputSchema.shape.name }))
		.handler(({ context, input }) => context.checks.cli(input.name)),
	/** Adds a CLI tool, or changes its description. */
	save: ownerProcedure
		.input(cliToolInputSchema)
		.handler(({ context, input }) => context.cliTools.save(input)),
	/** Also takes it off the profiles that name it. */
	remove: ownerProcedure
		.input(z.object({ name: z.string() }))
		.handler(async ({ context, input }) => {
			await context.cliTools.remove(input.name);
			for (const p of context.profiles.list()) {
				if (!p.clis.includes(input.name)) continue;
				const { updatedAt: _at, ...profile } = p;
				await context.profiles.save({
					...profile,
					clis: p.clis.filter((c) => c !== input.name),
				});
			}
		}),
};

/**
 * The decision models Decision nodes pick from, and whether each has its API
 * key. `value` says whether the decider can also make a value (a Value node
 * made by a model), and which chat model it starts on.
 */
const deciders = {
	list: ownerProcedure.handler(({ context }) =>
		deciderNameSchema.options.map((name) => {
			const adapter = DECIDER_ADAPTERS[name];
			return {
				name,
				label: adapter.label,
				pkg: adapter.pkg,
				models: [...adapter.models],
				defaultModel: adapter.defaultModel,
				apiKey: adapter.apiKey,
				apiKeySource: adapter.apiKey
					? context.connections.secretSource(adapter.apiKey)
					: null,
				value: adapter.value
					? { defaultModel: adapter.value.defaultModel }
					: null,
			};
		}),
	),
};

/**
 * Devices: this computer's own (its Hosts, "Be a Host"), and on a Host the
 * Person's paired Devices. A Person sees and removes their own Devices
 * only; approving a code binds it to the Person who entered it.
 */
const devices = {
	list: protectedProcedure.handler(({ context }) =>
		context.devices.overview({
			personId: context.session.user.id,
			owner: context.session.user.id === context.daemon.device.ownerId,
		}),
	),
	/** Shows the device that waits with this code, and holds the code for the Person. */
	review: protectedProcedure
		.input(z.object({ userCode: z.string().trim().min(1).max(32) }))
		.handler(({ context, input }) =>
			context.devices.review(context.headers, input.userCode),
		),
	approve: protectedProcedure
		.input(z.object({ userCode: z.string().trim().min(1).max(32) }))
		.handler(({ context, input }) =>
			context.devices.approve(context.headers, input.userCode),
		),
	deny: protectedProcedure
		.input(z.object({ userCode: z.string().trim().min(1).max(32) }))
		.handler(({ context, input }) =>
			context.devices.deny(context.headers, input.userCode),
		),
	/** Removes a Device's access to this computer. */
	revoke: protectedProcedure
		.input(z.object({ deviceId: z.string().min(1) }))
		.handler(({ context, input }) =>
			context.devices.revoke(context.session.user.id, input.deviceId),
		),
	/**
	 * Pairs this computer with a Host (`nightshift join`): yields the code to
	 * approve there, then the Host once it is approved.
	 */
	join: ownerProcedure
		.input(
			z.object({
				url: z.string().trim().min(1),
				role: z.enum(["home", "guest"]).default("home"),
			}),
		)
		.handler(async function* ({ context, input, signal }) {
			yield* context.devices.join(input, signal);
		}),
};

const deviceId = z.string().regex(/^[\w-]{1,64}$/);

/**
 * Pairing, as a joining Device calls it before it has a key. Public: the
 * device authorization flow is the check (a Person approves the code).
 */
const pairing = {
	start: publicProcedure
		.input(
			z.object({
				deviceId,
				name: z.string().trim().min(1).max(64),
				platform: z.string().trim().min(1).max(32),
			}),
		)
		.handler(({ context, input }) => context.devices.startPairing(input)),
	redeem: publicProcedure
		.input(
			z.object({
				deviceCode: z.string().min(1).max(256),
				deviceId,
				home: z.boolean(),
				address: z.string().url().max(512),
			}),
		)
		.handler(({ context, input }) => context.devices.redeemPairing(input)),
};

/** A paired Device's link to this Host: with its Device key. */
const link = {
	/** The first call on a link: who the Host is, and its addresses now. */
	hello: deviceProcedure("sync").handler(({ context }) =>
		context.devices.hello(context.deviceKey),
	),
	/** Every few seconds: the Device is online while these answer. */
	heartbeat: deviceProcedure("sync").handler(({ context }) =>
		context.devices.hello(context.deviceKey),
	),
};

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	spaces,
	projects,
	flows,
	gates,
	schedules,
	runs,
	settings,
	connections,
	cliTools,
	harnesses,
	deciders,
	profiles,
	devices,
	pairing,
	link,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
