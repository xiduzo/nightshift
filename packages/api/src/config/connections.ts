import {
	connectionInputSchema,
	customAgentOf,
	HARNESS_BIN,
	removeConnection,
	saveConnection,
} from "@nightshift/engine";
import {
	customHarnessSchema,
	harnessNameSchema,
	isCustomHarness,
	secretNameSchema,
} from "@nightshift/flows";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import {
	cliCheckSchema,
	connectionListSchema,
	connectionSchema,
	mcpTestResultSchema,
	mcpToolsSchema,
} from "./schemas";

const checkTarget = z.enum(harnessNameSchema.options);

/** The CLIs Night Shift runs (harnesses, gh) and the MCP servers Agent nodes name. */
export const connections = {
	list: ownerProcedure
		.route({
			summary:
				"Lists the connections (MCP servers) and secrets of this computer, with what uses them.",
		})
		.output(output(connectionListSchema))
		.handler(async ({ context }) => {
			const use = await context.space.flowUse();
			return {
				connections: context.connections.list().map((c) => ({
					...c,
					usedBy: use.connections.get(c.name) ?? [],
					profiles: context.profiles
						.list()
						.filter((p) => p.connections.includes(c.name))
						.map((p) => p.name),
				})),
				// A secret only a Command node names is listed too: saved or not.
				secrets: context.connections
					.secrets(use.secrets.keys())
					.map((secret) => ({
						...secret,
						flows: use.secrets.get(secret.name) ?? [],
					})),
			};
		}),
	/** Runs `--version` and the login check of one CLI. Read-only. */
	check: ownerProcedure
		.route({
			summary:
				"Checks the CLI of a harness or a custom agent: where it is, its version and its login.",
		})
		.output(output(cliCheckSchema))
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
		.route({ summary: "Adds a connection, or changes or renames one." })
		.output(output(connectionSchema))
		.input(
			connectionInputSchema.extend({
				/** The name it had, when the edit renames it. */
				previousName: z.string().optional(),
			}),
		)
		.handler(({ context, input }) => {
			const { previousName, ...connection } = input;
			return saveConnection(context, connection, previousName);
		}),
	/** Also takes it off the profiles that name it. */
	remove: ownerProcedure
		.route({
			summary:
				"Removes a connection, and takes it off the profiles that name it.",
		})
		.output(output(z.void()))
		.input(z.object({ name: z.string() }))
		.handler(({ context, input }) => removeConnection(context, input.name)),
	/** Connects to the server, lists its tools, and disconnects. A saved connection or a draft. */
	test: ownerProcedure
		.route({
			summary:
				"Connects to an MCP server, saved or a draft, and lists its tools.",
		})
		.output(output(mcpTestResultSchema))
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
		.route({ summary: "Saves a secret in the keychain of this computer." })
		.output(output(z.void()))
		.input(z.object({ name: secretNameSchema, value: z.string().min(1) }))
		.handler(({ context, input }) =>
			context.connections.setSecret(input.name, input.value),
		),
	removeSecret: ownerProcedure
		.route({ summary: "Removes a secret from the keychain of this computer." })
		.output(output(z.void()))
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
		.route({
			summary:
				"Lists the tools of a saved connection, with their input schemas.",
		})
		.output(output(mcpToolsSchema))
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
