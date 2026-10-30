import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness } from "@nightshift/agents/testing";
import { membersOf } from "@nightshift/auth";
import { createEngine, type Engine } from "@nightshift/engine";
import {
	createCliToolStore,
	createConnectionStore,
	createProfileStore,
	createSandbox,
	createSettingsStore,
	type Sandbox,
	waitFor,
	withDevice,
} from "@nightshift/engine/testing";
import { type Flow, singleAgentFlow } from "@nightshift/flows";
import {
	createInAppChannel,
	createNotifications,
	engineDigestSource,
	engineRunEvents,
	type Notifications,
} from "@nightshift/notifications";
import { OpenAPIGenerator } from "@orpc/openapi";
import { type AnyProcedure, call, isProcedure, Procedure } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { z } from "zod";

import type { Context } from "./context";
import { notificationItemSchema } from "./notifications/schemas";
import { type OutputMismatch, onOutputMismatch, output } from "./output";
import { appRouter } from "./router";
import { runStreamItemSchema } from "./runs/schemas";
import { accessAs, testContext } from "./testing";

/**
 * The router as a contract: every procedure says what it does and what it
 * returns, an OpenAPI document builds from it, and an output schema never
 * changes what a procedure returns.
 */

/** Every procedure of the router, by its path (`runs.get`). */
function proceduresOf(
	router: Record<string, unknown>,
	prefix: string[] = [],
): [string, AnyProcedure][] {
	return Object.entries(router).flatMap(([key, value]) =>
		isProcedure(value)
			? [[[...prefix, key].join("."), value] as [string, AnyProcedure]]
			: proceduresOf(value as Record<string, unknown>, [...prefix, key]),
	);
}

describe("the router", () => {
	const procedures = proceduresOf(appRouter);

	test("gives every procedure a one-line summary and an output schema", () => {
		expect(procedures.length).toBeGreaterThan(90);
		for (const [path, procedure] of procedures) {
			const { route, outputSchema } = procedure["~orpc"];
			expect(route.summary, path).toBeString();
			expect(route.summary?.includes("\n"), path).toBe(false);
			expect(outputSchema, path).toBeDefined();
		}
	});

	test("builds an OpenAPI document with a summary and a response schema per operation", async () => {
		const document = await new OpenAPIGenerator({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}).generate(appRouter, {
			info: { title: "Night Shift", version: "0.0.0" },
		});
		const operations = Object.values(document.paths ?? {}).flatMap((item) =>
			Object.values(item ?? {}),
		) as {
			operationId?: string;
			summary?: string;
			responses?: Record<string, { content?: Record<string, unknown> }>;
		}[];
		expect(operations).toHaveLength(procedures.length);
		for (const operation of operations) {
			expect(operation.summary, operation.operationId).toBeString();
			const content = operation.responses?.["200"]?.content ?? {};
			const [media] = Object.values(content) as { schema?: unknown }[];
			expect(media?.schema, operation.operationId).toBeDefined();
		}
	});
});

describe("output", () => {
	const schema = output(z.object({ name: z.string() }));

	test("returns the handler's own value, with the keys the schema does not name", async () => {
		const value = { name: "night", extra: 1 };
		const result = await schema["~standard"].validate(value);
		expect(result).toEqual({ value });
		expect((result as { value: unknown }).value).toBe(value);
	});

	test("reports a value that does not match, and still returns it", async () => {
		const seen: OutputMismatch[] = [];
		const restore = onOutputMismatch((mismatch) => seen.push(mismatch));
		try {
			const value = { name: 7 };
			const result = await schema["~standard"].validate(value);
			expect((result as { value: unknown }).value).toBe(value);
			expect(seen).toHaveLength(1);
			expect(seen[0]?.value).toBe(value);
		} finally {
			restore();
		}
	});
});

/**
 * Real replies, from a real engine in a sandbox: each must match its
 * schema, and the reply with the schema must equal the reply without it.
 */
describe("replies of a real engine", () => {
	let sandbox: Sandbox;
	let engine: Engine;
	let notifications: Notifications;
	const inApp = createInAppChannel();
	let context: Context;
	const mismatches: { path: string; mismatch: OutputMismatch }[] = [];
	let current = "";
	let restore: () => void;
	const realFetch = globalThis.fetch;

	beforeAll(async () => {
		sandbox = await createSandbox();
		// The Ollama decider lists its models over HTTP: it does not run here.
		globalThis.fetch = (async () => {
			throw new Error("Unable to connect.");
		}) as unknown as typeof fetch;
		restore = onOutputMismatch((mismatch) =>
			mismatches.push({ path: current, mismatch }),
		);
		// The personal Space has one Member: this computer's owner.
		const { members } = await membersOf(sandbox.db, sandbox.spaceId);
		const personId = members[0]?.personId ?? "";
		const document = await sandbox.openDocument();
		const secrets: Parameters<typeof createConnectionStore>[0]["secrets"] = {
			get: async () => null,
			set: async () => {},
			delete: async () => {},
		};
		const settings = createSettingsStore({ document, env: {} });
		await settings.load();
		engine = createEngine(
			withDevice({
				db: sandbox.db,
				dataDir: sandbox.dataDir,
				deviceId: sandbox.deviceId,
				harnesses: { "claude-code": fakeHarness() },
			}),
		);
		notifications = createNotifications({
			db: sandbox.db,
			events: engineRunEvents(engine),
			sendsFor: async () => true,
			inApp,
			digests: engineDigestSource(engine),
		});
		await notifications.start();
		context = testContext({
			access: accessAs({ personId, spaceId: sandbox.spaceId, role: "owner" }),
			fromThisComputer: true,
			db: sandbox.db,
			engine,
			settings,
			notifications,
			connections: createConnectionStore({ document, env: {}, secrets }),
			cliTools: createCliToolStore({ document }),
			toolLaunchers: {
				signIn: async () => ({ ok: false, output: "", signedInAt: null }),
				signedInAt: async () => null,
				forget: async () => {},
			},
			profiles: createProfileStore({ document }),
			daemon: {
				dataDir: sandbox.dataDir,
				device: { id: sandbox.deviceId, name: "test", ownerId: personId },
				lease: { host: "test", pid: 1, epoch: 1, since: 0 },
			},
		});
	});

	afterAll(async () => {
		restore();
		globalThis.fetch = realFetch;
		notifications.stop();
		await engine.dispose();
		await sandbox.cleanup();
	});

	/** Calls a procedure through the router: its reply, checked against its schema. */
	async function reply(procedure: AnyProcedure, input?: unknown) {
		current = pathOf(procedure);
		return call(procedure, input, { context });
	}

	/** A read: the reply with its output schema equals the reply without one. */
	async function read(procedure: AnyProcedure, input?: unknown) {
		const withSchema = await reply(procedure, input);
		const bare = new Procedure({
			...procedure["~orpc"],
			outputSchema: undefined,
		});
		const without = await call(bare, input, { context });
		expect(withSchema, current).toEqual(without);
		return withSchema;
	}

	const paths = new Map(proceduresOf(appRouter).map(([p, v]) => [v, p]));
	const pathOf = (procedure: AnyProcedure) => paths.get(procedure) ?? "?";

	test("the flow-building procedures reply as their schemas say", async () => {
		const project = (await reply(appRouter.projects.add, {
			repoPath: sandbox.repoPath,
		})) as { id: string };
		const projectId = project.id;
		await read(appRouter.projects.list);
		await read(appRouter.projects.branches, { projectId });

		await reply(appRouter.connections.save, {
			name: "gh",
			server: { command: "gh-mcp", args: [], env: {} },
		});
		await reply(appRouter.cliTools.save, { name: "jq" });
		// A second account of gh: its login reads a secret.
		await reply(appRouter.cliTools.save, {
			name: "gh-work",
			program: "gh",
			login: { env: { GH_TOKEN: "${GH_WORK_TOKEN}" } },
			git: { host: "github.com" },
		});
		await reply(appRouter.profiles.save, {
			name: "fast",
			harness: "claude-code",
			model: "sonnet",
			permissionMode: "acceptEdits",
			clis: ["jq"],
			connections: ["gh"],
		});

		const night = singleAgentFlow({
			prompt: "Fix the bug.",
			model: "sonnet",
			permissionMode: "acceptEdits",
		});
		const tools: Flow = {
			...night,
			nodes: [
				...night.nodes.map((node) =>
					node.type === "agent"
						? { ...node, profile: "fast", clis: ["jq"], connections: ["gh"] }
						: node,
				),
				{
					id: "login",
					type: "command",
					position: { x: 0, y: 200 },
					command: 'curl -u "$ZAC_USER:$ZAC_PASSWORD" https://zac.test',
					output: "text",
					secrets: ["ZAC_USER", "ZAC_PASSWORD"],
				},
			],
			edges: [{ id: "e1", from: "agent", outcome: "pass", to: "login" }],
		};
		await reply(appRouter.flows.save, {
			projectId,
			name: "night",
			flow: night,
		});
		await reply(appRouter.flows.save, {
			projectId,
			name: "tools",
			flow: tools,
		});
		await read(appRouter.flows.list, { projectId });
		await read(appRouter.flows.map, { projectId });
		await read(appRouter.flows.get, { projectId, name: "night" });
		// A second save of night, so its revisions have a diff between them.
		await reply(appRouter.flows.save, {
			projectId,
			name: "night",
			flow: { ...night, description: "Fix the bug at night." },
		});
		const revisions = (await read(appRouter.flows.revisions, {
			projectId,
			name: "night",
		})) as { id: string }[];
		expect(revisions).toHaveLength(2);
		const [newest, oldest] = revisions.map((revision) => revision.id);
		await read(appRouter.flows.revision, {
			projectId,
			name: "night",
			revisionId: oldest,
		});
		await read(appRouter.flows.revision, {
			projectId,
			name: "night",
			revisionId: newest,
			against: oldest,
		});
		await reply(appRouter.flows.restore, {
			projectId,
			name: "night",
			revisionId: oldest,
		});
		const exported = (await read(appRouter.flows.export, {
			projectId,
			name: "night",
		})) as { json: string };
		const imported = (await reply(appRouter.flows.import, {
			projectId,
			name: "night",
			json: exported.json,
		})) as { name: string };
		expect(imported.name).toBe("night-2");
		await reply(appRouter.flows.copy, {
			projectId,
			name: "night",
			toProjectId: projectId,
			as: "night-copy",
		});

		// Sections round-trip, and a Section issue names its Section.
		const sections: Flow["sections"] = [
			{ id: "work", label: "Work", color: "blue", nodes: ["agent"] },
			{ id: "stray", label: "Stray", nodes: ["nowhere"] },
		];
		const sectionIssues = (await reply(appRouter.flows.save, {
			projectId,
			name: "sectioned",
			flow: { ...night, sections },
		})) as { sectionId?: string }[];
		expect(sectionIssues).toContainEqual(
			expect.objectContaining({ severity: "warning", sectionId: "stray" }),
		);
		const sectioned = (await read(appRouter.flows.get, {
			projectId,
			name: "sectioned",
		})) as { flow: Flow | null };
		expect(sectioned.flow?.sections).toEqual(sections);

		await read(appRouter.profiles.list);
		await reply(appRouter.connections.setSecret, {
			name: "ZAC_USER",
			value: "behandelaar",
		});
		const list = (await read(appRouter.connections.list)) as {
			secrets: { name: string; saved: boolean; flows: unknown[] }[];
		};
		// The flows whose Command nodes name a secret, saved or not, and
		// when it was set (only a saved one) and used (not yet).
		const toolsFlow = { projectId, projectName: expect.any(String) };
		expect(list.secrets).toEqual([
			// A secret only a CLI tool's login reads.
			expect.objectContaining({
				name: "GH_WORK_TOKEN",
				saved: false,
				flows: [],
				tools: ["gh-work"],
			}),
			expect.objectContaining({
				name: "ZAC_PASSWORD",
				saved: false,
				flows: [{ ...toolsFlow, flowName: "tools" }],
				setAt: null,
				usedAt: null,
			}),
			expect.objectContaining({
				name: "ZAC_USER",
				saved: true,
				flows: [{ ...toolsFlow, flowName: "tools" }],
				setAt: expect.any(Number),
				usedAt: null,
			}),
		]);
		await read(appRouter.cliTools.list);
		await reply(appRouter.cliTools.signIn, { name: "gh-work" });
		await read(appRouter.harnesses.list);
		await read(appRouter.deciders.list);
		await read(appRouter.settings.get);

		await reply(appRouter.schedules.save, {
			projectId,
			schedules: [{ id: "nightly", flow: "night", cron: "0 22 * * 1-5" }],
		});
		await read(appRouter.schedules.list, { projectId });
		await read(appRouter.schedules.preview, { cron: "0 22 * * 1-5" });

		await read(appRouter.notifications.settings.get);
		await reply(appRouter.notifications.settings.save, { holdMinutes: 5 });
		await reply(appRouter.notifications.targets.register, {
			kind: "web",
			name: "This browser",
			endpoint: "https://fcm.googleapis.com/fcm/send/abc",
			keys: { p256dh: "key", auth: "secret" },
		});
		await read(appRouter.notifications.targets.list);
		const told = new AbortController();
		const toldOf = (await call(appRouter.notifications.watch, undefined, {
			context,
			signal: told.signal,
		})) as AsyncIterator<unknown>;
		/** What the stream says until the run ends: quiet changes first, then its end. */
		const notices = (async () => {
			const items: unknown[] = [];
			for (;;) {
				const next = await toldOf.next();
				if (next.done) return items;
				items.push(next.value);
				if ((next.value as { kind: string }).kind === "run-finished") {
					return items;
				}
			}
		})();
		const me = context.access.session?.user.id ?? "";
		while (!inApp.isActive(me)) await Bun.sleep(5);

		const started = (await reply(appRouter.runs.start, {
			projectId,
			flowName: "night",
		})) as { id: string };
		await waitFor(
			async () => {
				const run = (await call(
					appRouter.runs.get,
					{ runId: started.id },
					{ context },
				)) as { status: string };
				return run.status === "running" ? null : run.status;
			},
			{ label: "the run to end" },
		);
		await read(appRouter.runs.list);
		await read(appRouter.runs.list, { projectId });
		const page = (await read(appRouter.runs.list, {
			projectId,
			limit: 1,
			statuses: ["finished", "failed"],
		})) as { id: string; endedAt: number | null; metrics?: unknown }[];
		expect(page.map((r) => r.id)).toEqual([started.id]);
		// The run list carries the run's metrics: the digest and the Runs table read them.
		expect(page[0]?.metrics).toEqual({
			wallMs: expect.any(Number),
			agentMs: expect.any(Number),
			gateWaitMs: 0,
			tokens: expect.objectContaining({ input: expect.any(Number) }),
			costBasis: expect.stringMatching(/^(billed|estimated|unknown)$/),
			prUrl: null,
		});
		const listed = (await read(appRouter.projects.list)) as {
			id: string;
			runs?: { total: number };
		}[];
		expect(listed.find((p) => p.id === projectId)?.runs?.total).toBe(1);
		const detail = (await read(appRouter.runs.get, { runId: started.id })) as {
			steps: { id: string; metrics?: { wallMs: number | null } }[];
		};
		// Each step carries its own metrics, for the run's per-node rows.
		expect(detail.steps.length).toBeGreaterThan(0);
		for (const step of detail.steps) {
			expect(step.metrics?.wallMs).toBeNumber();
		}
		for (const step of detail.steps) {
			await read(appRouter.runs.step, { runId: started.id, stepId: step.id });
		}
		await read(appRouter.runs.placements, { projectId });
		await read(appRouter.runs.devices, { projectId });
		expect(
			await read(appRouter.profiles.catalog, {
				spaceId: sandbox.spaceId,
				projectId,
			}),
		).toEqual([
			{
				deviceId: sandbox.deviceId,
				name: expect.any(String),
				thisDevice: true,
				mine: true,
				online: true,
				// This engine knows no profiles of this computer.
				profiles: null,
			},
		]);
		await read(appRouter.runs.moveTargets, { runId: started.id });
		const copies = (await read(appRouter.projects.runCopies, {
			projectId,
		})) as { copies: { runId: string }[] };
		expect(copies.copies.map((c) => c.runId)).toEqual([started.id]);
		await read(appRouter.gates.list);
		// A digest read now (its `to` is now: two replies differ): the run that ended is its one line.
		const digest = (await reply(appRouter.notifications.digest.since, {
			since: 0,
		})) as { runs: { runId: string }[] } | null;
		expect(digest?.runs.map((r) => r.runId)).toEqual([started.id]);
		const heard = await notices;
		for (const notice of heard) {
			expect(
				notificationItemSchema.safeParse(notice).error,
				"notifications.watch",
			).toBe(undefined);
		}
		expect(heard[0]).toMatchObject({ kind: "run-changed", runId: started.id });
		expect(heard.at(-1)).toMatchObject({
			kind: "run-finished",
			runId: started.id,
		});
		told.abort();
		await toldOf.return?.();

		// The dashboard says when it computed its numbers: two replies differ.
		await reply(appRouter.dashboard.summary, { timeZone: "Europe/Amsterdam" });
		await reply(appRouter.dashboard.summary, { everySpace: true });
		const projectDashboard = (await reply(appRouter.dashboard.summary, {
			projectId,
		})) as { cards: { lastDay: { runs: number } } };
		expect(projectDashboard.cards.lastDay.runs).toBe(1);
		await reply(appRouter.dashboard.flow, { projectId, flowName: "night" });

		const controller = new AbortController();
		const events = (await call(
			appRouter.runs.watch,
			{ runId: started.id },
			{ context, signal: controller.signal },
		)) as AsyncIterable<unknown>;
		let watched = 0;
		for await (const item of events) {
			expect(runStreamItemSchema.safeParse(item).error, "runs.watch").toBe(
				undefined,
			);
			watched += 1;
			if ((item as { kind: string }).kind === "transcript") break;
		}
		controller.abort();
		expect(watched).toBeGreaterThan(1);

		await read(appRouter.spaces.list);
		await read(appRouter.members.list);
		await read(appRouter.account.status);
		await read(appRouter.healthCheck);
		await read(appRouter.programs.found);

		expect(mismatches).toEqual([]);
	});

	test("a project added with the starters has them as its flows", async () => {
		const repoPath = join(sandbox.root, "with-starters");
		await mkdir(repoPath, { recursive: true });
		for (const args of [
			["init", "-q", "-b", "main"],
			[
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.com",
				"commit",
				"-q",
				"--allow-empty",
				"-m",
				"initial",
			],
		]) {
			expect(Bun.spawnSync(["git", ...args], { cwd: repoPath }).exitCode).toBe(
				0,
			);
		}
		const project = (await reply(appRouter.projects.add, {
			repoPath,
			starters: true,
		})) as { id: string };
		const flows = (await read(appRouter.flows.list, {
			projectId: project.id,
		})) as { name: string }[];
		expect(flows.map((flow) => flow.name)).toContain("implement-and-check");
		expect(flows).toHaveLength(7);
		expect(mismatches).toEqual([]);
	});
});
