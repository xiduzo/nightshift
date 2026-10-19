import { DECIDER_ADAPTERS, HARNESS_ADAPTERS } from "@nightshift/agents";
import { invitationView, membersOf } from "@nightshift/auth/members";
import { spacesOf } from "@nightshift/auth/spaces";
import {
	archiveRefSchema,
	chooseFolder,
	cliToolInputSchema,
	connectionInputSchema,
	ForeignRowsError,
	HARNESS_BIN,
	runRowsSchema,
	secretNameSchema,
	settingsPatchSchema,
	syncCursorsSchema,
	type WorkRequest,
	workReplySchema,
	workRequestSchema,
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
	readable,
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

const role = z.enum(["owner", "admin", "member", "viewer"]);

/**
 * The Members of the session's Space: who is in it with which role, and
 * who is invited. Each change needs its `member` permission; the
 * organization plugin checks the role again. A personal Space has one
 * Member and takes no invitations.
 */
const members = {
	list: protectedProcedure.handler(async ({ context }) => {
		const [listed, spaces, invite, remove, changeRole] = await Promise.all([
			membersOf(context.db, context.spaceId),
			spacesOf(context.db, context.session.user.id),
			context.can({ member: ["invite"] }),
			context.can({ member: ["remove"] }),
			context.can({ member: ["role"] }),
		]);
		const space = spaces.find((s) => s.id === context.spaceId);
		return {
			space: {
				id: context.spaceId,
				name: space?.name ?? "",
				personal: space?.personal ?? false,
				role: space?.role ?? null,
			},
			you: context.session.user.id,
			...listed,
			can: { invite, remove, changeRole },
		};
	}),
	/** Invites an email with a role. The link to accept it carries the invitation's id. */
	invite: permitted({ member: ["invite"] })
		.input(
			z.object({
				email: z.email().max(254),
				role: role.exclude(["owner"]),
			}),
		)
		.handler(({ context, input }) =>
			context.members.invite(input.email.toLowerCase(), input.role),
		),
	cancelInvitation: permitted({ member: ["invite"] })
		.input(z.object({ invitationId: z.string().min(1) }))
		.handler(({ context, input }) =>
			context.members.cancelInvitation(input.invitationId),
		),
	setRole: permitted({ member: ["role"] })
		.input(z.object({ memberId: z.string().min(1), role }))
		.handler(({ context, input }) =>
			context.members.setRole(input.memberId, input.role),
		),
	remove: permitted({ member: ["remove"] })
		.input(z.object({ memberId: z.string().min(1) }))
		.handler(({ context, input }) => context.members.remove(input.memberId)),
};

/**
 * Invitations, as the person who got the link sees them. `get` is public:
 * the id is the link's secret, and the page shows it before anyone signs
 * in. `accept` needs a session of the invited email.
 */
const invitations = {
	get: publicProcedure
		.input(z.object({ invitationId: z.string().min(1).max(128) }))
		.handler(async ({ context, input }) => {
			const found = await invitationView(context.db, input.invitationId);
			if (!found) {
				throw new ORPCError("NOT_FOUND", {
					message: "This invitation does not exist. Ask for a new one.",
				});
			}
			return found;
		}),
	/** Joins the invitation's Space and works in it from now on. */
	accept: protectedProcedure
		.input(z.object({ invitationId: z.string().min(1).max(128) }))
		.handler(({ context, input }) =>
			context.members.accept(input.invitationId),
		),
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

/** What starts a run: a flow file or an inline flow, and where its steps run. */
const runStartFields = {
	projectId: z.string(),
	baseRef: z.string().min(1).optional(),
	stopAt: z.number().int().positive().optional(),
	inputs: z.record(z.string(), z.json()).optional(),
	/** The Device the run's steps run on. Default: this computer. */
	deviceId: z.string().min(1).max(64).optional(),
};
const runStartInput = z.union([
	z.object({ ...runStartFields, flowName: flowNameSchema }),
	z.object({ ...runStartFields, flow: flowSchema }),
]);

const runs = {
	/** The Person's Devices a run of the project can run on: this computer first. */
	placements: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listPlacements(input.projectId),
		),
	list: protectedProcedure
		.input(z.object({ projectId: z.string().optional() }).optional())
		.handler(({ context, input }) => context.space.listRuns(input)),
	get: protectedProcedure
		.input(z.object({ runId: z.string() }))
		.handler(({ context, input }) => context.space.getRun(input.runId)),
	/**
	 * Starts a flow file by name, or a flow given inline (a quick run), on
	 * one of the Person's Devices (`placements`; default this computer).
	 */
	start: permitted({ run: ["start"] })
		.input(runStartInput)
		.handler(({ context, input }) =>
			context.space.startRun({
				...input,
				startedBy: context.session.user.id,
			}),
		),
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
	/**
	 * Another of the Person's Devices walks the run from here on: from its
	 * archived checkpoint. Not while a step runs.
	 */
	move: permitted({ run: ["move"] })
		.input(z.object({ runId: z.string(), deviceId: z.string().min(1).max(64) }))
		.handler(({ context, input }) =>
			context.space.moveRun(input.runId, input.deviceId),
		),
	/** The Person's Devices for the project: online, with a Clone or not (a node's Device, Move to). */
	devices: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listDevices(input.projectId),
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
	 * The relay's work half, as a placed Device calls it on its Host with
	 * its Device key: the calls of the runs the Host walks on this Device,
	 * as they come. The Host never dials a Device.
	 */
	work: deviceProcedure("relay")
		.input(
			z
				.object({
					/** The calls the Device still serves: any other it took has ended there. */
					running: z.array(z.string().min(1).max(64)).max(1_000),
				})
				.default({ running: [] }),
		)
		.handler(async function* ({ context, input, signal }) {
			yield* context.exchange.work(context.deviceKey, input, signal);
		}),
	/**
	 * The Walker → Host → Device leg: a Device that walks a run calls
	 * another of its Person's Devices (or this Host) through here; the
	 * stream carries the replies, and closing it cancels the call.
	 */
	call: deviceProcedure("relay")
		.input(
			z.object({
				deviceId: z.string().min(1).max(64),
				request: workRequestSchema,
			}),
		)
		.handler(async function* ({ context, input, signal }) {
			yield* context.exchange.call(
				context.deviceKey,
				{
					deviceId: input.deviceId,
					request: input.request as unknown as WorkRequest,
				},
				signal,
			);
		}),
	/** Whether one of the key's Person's Devices (or this Host) takes work now. */
	reachable: deviceProcedure("relay")
		.input(z.object({ deviceId: z.string().min(1).max(64) }))
		.handler(({ context, input }) =>
			context.exchange.reachable(context.deviceKey, input.deviceId),
		),
	/** The placed Device's answers to a call it took. */
	workReply: deviceProcedure("relay")
		.input(
			z.object({
				id: z.string().min(1).max(64),
				replies: z.array(workReplySchema).max(1_000),
				done: z.boolean(),
			}),
		)
		.handler(({ context, input }) =>
			context.exchange.workReply(context.deviceKey, input),
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
			try {
				yield* context.devices.join(input, signal);
			} catch (error) {
				throw readable(error);
			}
		}),
};

/**
 * The owner's own sign-in, set on this computer: a Host without a screen
 * has a Host admin who signs in for nothing there, and needs an email and a
 * password to sign in from a browser elsewhere (`nightshift admin`).
 */
const account = {
	setLogin: ownerProcedure
		.input(
			z.object({
				email: z.string().trim().min(3).max(254),
				password: z.string().min(1).max(256),
				name: z.string().trim().max(64).optional(),
			}),
		)
		.handler(({ context, input }) => {
			if (!context.fromThisComputer) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"Set the sign-in of this computer's owner on the computer itself.",
				});
			}
			return context.setLogin(context.session.user.id, input);
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

/**
 * The event log exchange, as a paired Device calls it on its Host with its
 * Device key: run history in and out by cursor, live, and the commands
 * for the runs it walks. The Host filters every call by the membership of
 * the key's Person.
 */
const sync = {
	/** Rows of other Walkers after the Device's cursors, and its commands. */
	pull: deviceProcedure("sync")
		.input(z.object({ cursors: syncCursorsSchema }))
		.handler(({ context, input }) =>
			context.exchange.pull(context.deviceKey, input.cursors),
		),
	/** The same, then every new batch as it lands. */
	stream: deviceProcedure("sync")
		.input(z.object({ cursors: syncCursorsSchema }))
		.handler(async function* ({ context, input, signal }) {
			yield* context.exchange.stream(context.deviceKey, input.cursors, signal);
		}),
	/** The Device's own rows: runs it walks, in Spaces its owner is in. */
	push: deviceProcedure("sync")
		.input(runRowsSchema)
		.handler(async ({ context, input }) => {
			try {
				return await context.exchange.push(context.deviceKey, input);
			} catch (error) {
				if (error instanceof ForeignRowsError) {
					throw new ORPCError("FORBIDDEN", { message: error.message });
				}
				throw error;
			}
		}),
	/** A person's action on a run walked elsewhere, in the name of the key's Person. */
	command: deviceProcedure("sync")
		.input(
			z.discriminatedUnion("kind", [
				z.object({
					runId: z.string().min(1),
					kind: z.literal("gate.resolve"),
					payload: z.object({
						stepId: z.string().min(1),
						choice: z.string().min(1),
						note: z.string().optional(),
					}),
				}),
				z.object({
					runId: z.string().min(1),
					kind: z.literal("signal.send"),
					payload: z.object({ name: labelSchema }),
				}),
				z.object({
					runId: z.string().min(1),
					kind: z.literal("run.stop"),
					payload: z.object({
						when: z.enum(["now", "after-step"]).optional(),
					}),
				}),
				z.object({
					runId: z.string().min(1),
					kind: z.literal("run.move"),
					payload: z.object({ to: z.string().min(1).max(64) }),
				}),
			]),
		)
		.handler(({ context, input }) =>
			context.exchange.command(context.deviceKey, input),
		),
	/** The Walker applied a command, or says why not. */
	commandDone: deviceProcedure("sync")
		.input(
			z.object({
				id: z.string().min(1),
				error: z.string().max(2_000).nullable(),
			}),
		)
		.handler(({ context, input }) =>
			context.exchange.commandDone(context.deviceKey, input),
		),
	/** Starts a run placed on another Device, for the key's Person: this Host walks it. */
	startRun: deviceProcedure("sync")
		.input(
			z.union([
				z.object({
					...runStartFields,
					flowName: flowNameSchema,
					spaceId: z.string().min(1),
					deviceId: z.string().min(1).max(64),
				}),
				z.object({
					...runStartFields,
					flow: flowSchema,
					spaceId: z.string().min(1),
					deviceId: z.string().min(1).max(64),
				}),
			]),
		)
		.handler(({ context, input }) =>
			context.exchange.startRun(context.deviceKey, input),
		),
	/** The key's Person's Devices for a project: online, with a Clone or not. */
	devices: deviceProcedure("sync")
		.input(z.object({ spaceId: z.string().min(1), projectId: z.string() }))
		.handler(({ context, input }) =>
			context.exchange.devices(context.deviceKey, input),
		),
	/** The Device has a Clone of a Project of a Space here. */
	addClone: deviceProcedure("sync")
		.input(
			z.object({
				spaceId: z.string().min(1),
				projectId: z.string().min(1),
				deviceName: z.string().trim().min(1).max(64),
			}),
		)
		.handler(({ context, input }) =>
			context.exchange.addClone(context.deviceKey, input),
		),
};

/** The archive: the run state of runs walked elsewhere, per Space. */
const archive = {
	/** The Walker keeps a step's transcript or command log, or its run's checkpoints, here. */
	put: deviceProcedure("archive")
		.input(z.object({ ref: archiveRefSchema, content: z.string() }))
		.handler(({ context, input }) =>
			context.exchange.archivePut(context.deviceKey, input.ref, input.content),
		),
	/** A file of a run in a Space the Device's owner is in. Null when there is none. */
	get: deviceProcedure("archive")
		.input(z.object({ ref: archiveRefSchema }))
		.handler(({ context, input }) =>
			context.exchange.archiveGet(context.deviceKey, input.ref),
		),
};

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	spaces,
	members,
	invitations,
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
	account,
	pairing,
	link,
	sync,
	archive,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
