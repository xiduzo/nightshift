import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { membersOf } from "@nightshift/auth";
import {
	createCliToolStore,
	createConnectionStore,
	createEngine,
	createProfileStore,
	createSettingsStore,
	type Engine,
} from "@nightshift/engine";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "@nightshift/engine/testing";
import { type Flow, singleAgentFlow } from "@nightshift/flows";
import { OpenAPIGenerator } from "@orpc/openapi";
import { type AnyProcedure, call, isProcedure, Procedure } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { z } from "zod";

import type { Context } from "./context";
import { type OutputMismatch, onOutputMismatch, output } from "./output";
import { appRouter } from "./router";
import { runStreamItemSchema } from "./runs/schemas";

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
		context = {
			session: {
				user: {
					id: personId,
					name: "Ada",
					email: "ada@example.com",
					twoFactorEnabled: false,
				},
			},
			spaceId: sandbox.spaceId,
			can: async () => true,
			setActiveSpace: async () => {},
			headers: new Headers(),
			fromThisComputer: true,
			hostAccess: { allowed: true },
			requireTwoFactor: false,
			db: sandbox.db,
			engine,
			settings,
			connections: createConnectionStore({ document, env: {}, secrets }),
			cliTools: createCliToolStore({ document }),
			profiles: createProfileStore({ document }),
			daemon: {
				dataDir: sandbox.dataDir,
				device: { id: sandbox.deviceId, name: "test", ownerId: personId },
				lease: { host: "test", pid: 1, epoch: 1, since: 0 },
			},
		} as unknown as Context;
	});

	afterAll(async () => {
		restore();
		globalThis.fetch = realFetch;
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
			nodes: night.nodes.map((node) =>
				node.type === "agent"
					? { ...node, profile: "fast", clis: ["jq"], connections: ["gh"] }
					: node,
			),
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
		await read(appRouter.flows.get, { projectId, name: "night" });

		await read(appRouter.profiles.list);
		await read(appRouter.connections.list);
		await read(appRouter.cliTools.list);
		await read(appRouter.harnesses.list);
		await read(appRouter.deciders.list);
		await read(appRouter.settings.get);

		await reply(appRouter.schedules.save, {
			projectId,
			schedules: [{ id: "nightly", flow: "night", cron: "0 22 * * 1-5" }],
		});
		await read(appRouter.schedules.list, { projectId });
		await read(appRouter.schedules.preview, { cron: "0 22 * * 1-5" });

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
		await read(appRouter.runs.get, { runId: started.id });
		await read(appRouter.runs.placements, { projectId });
		await read(appRouter.runs.devices, { projectId });
		await read(appRouter.gates.list);

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

		expect(mismatches).toEqual([]);
	});
});
