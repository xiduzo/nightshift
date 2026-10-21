import {
	connectionInputSchema,
	HARNESS_BIN,
	secretNameSchema,
} from "@nightshift/engine";
import {
	customHarnessSchema,
	harnessNameSchema,
	isCustomHarness,
} from "@nightshift/flows";
import { z } from "zod";

import { ownerProcedure } from "../procedures";
import { customAgentOf } from "./harnesses";

const checkTarget = z.enum(harnessNameSchema.options);

/** The CLIs Night Shift runs (harnesses, gh) and the MCP servers Agent nodes name. */
export const connections = {
	list: ownerProcedure.handler(async ({ context }) => {
		const use = (await context.space.flowUse()).connections;
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
		.input(z.object({ target: z.union([checkTarget, customHarnessSchema]) }))
		.handler(({ context, input }) => {
			const values = context.settings.current();
			if (isCustomHarness(input.target)) {
				const agent = customAgentOf(values.customAgents, input.target);
				if (!agent) {
					throw new Error("This custom agent was removed. Add it again.");
				}
				return context.checks.customAgent(agent.command, agent.label);
			}
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
