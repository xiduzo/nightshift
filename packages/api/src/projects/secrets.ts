import type { Permissions } from "@nightshift/auth";
import { cliToolsOfSecrets, HostUnreachableError } from "@nightshift/engine";
import { secretNameSchema } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { z } from "zod";

import { secretScopeSchema } from "../config";
import { output } from "../output";
import { ownerOnly, permitted, protectedProcedure } from "../procedures";
import { projectProcedure } from "./project-space";
import { projectSecretListSchema } from "./schemas";

/** What the Project secret procedures share: the project, in the session's Space. */
const projectInput = z.object({ projectId: z.string() });

/** The secrets could not be read now: the Host of the Space is away, or older. */
function unreachable(error: unknown): boolean {
	return (
		error instanceof HostUnreachableError ||
		(error instanceof Refusal && error.kind === "unavailable")
	);
}

/** The names of the flows of one project among `flows`. */
function flowsOf(
	projectId: string,
	flows: readonly { projectId: string; flowName: string }[],
): string[] {
	return flows.filter((f) => f.projectId === projectId).map((f) => f.flowName);
}

/** A role that saves Flows: it sets, replaces, moves and removes a project's secrets. */
const SAVING = { flow: ["save"] } satisfies Permissions;

/** A move that changes this computer's secrets or its owner's: the owner's, with a role that saves Flows. */
const ownerSaving = permitted(SAVING).use(ownerOnly);

/**
 * A Project's secrets (ADR 13): every Member sees their names, who set
 * each and when, and the flows of the project that use each. A Member
 * whose role saves Flows sets, replaces, moves and removes them. Nobody
 * reads a value back. The Host that keeps the Space keeps them: this
 * computer asks it, or keeps them itself for a Space it keeps. Each
 * procedure keyed by a project checks it is the Space's first
 * (`projectProcedure`), and passes the project on as `context.project`.
 */
export const projectSecrets = {
	secrets: projectProcedure(projectInput)
		.route({
			summary:
				"Lists the secrets of a project, with who set each, when, and the flows that use it.",
		})
		.output(output(projectSecretListSchema))
		.handler(async ({ context }) => {
			const at = context.project;
			const canChange = await context.access.can(SAVING);
			let listed: Awaited<
				ReturnType<typeof context.connections.projectSecrets>
			>;
			try {
				listed = await context.connections.projectSecrets(
					at,
					context.session.user.id,
				);
			} catch (error) {
				if (!unreachable(error)) throw error;
				return { secrets: [], available: false, canChange };
			}
			const use = await context.space.flowUse();
			const connections = context.connections.list();
			const { toolsBySecret, toolFlows } = cliToolsOfSecrets(context, use);
			return {
				secrets: listed.map((secret) => {
					// The flows whose Command nodes name it, those whose Agent and
					// Tool nodes use a connection that reads it, and those that use a
					// CLI tool whose login reads it.
					const tools = toolsBySecret.get(secret.name) ?? [];
					const viaTools = tools.flatMap((tool) =>
						flowsOf(at.projectId, toolFlows.get(tool) ?? []),
					);
					const viaConnections = connections
						.filter((c) => c.variables.some((v) => v.name === secret.name))
						.flatMap((c) =>
							flowsOf(at.projectId, use.connections.get(c.name) ?? []),
						);
					return {
						...secret,
						flows: [
							...new Set([
								...flowsOf(at.projectId, use.secrets.get(secret.name) ?? []),
								...viaConnections,
								...viaTools,
							]),
						].sort(),
						tools: [...tools].sort(),
						webhooks: [
							...new Set(
								flowsOf(at.projectId, use.webhooks.get(secret.name) ?? []),
							),
						].sort(),
					};
				}),
				available: true,
				canChange,
			};
		}),
	setSecret: projectProcedure(
		projectInput.extend({ name: secretNameSchema, value: z.string().min(1) }),
		permitted(SAVING),
	)
		.route({
			summary:
				"Saves a secret of a project, or replaces its value. The value never comes back.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.connections.setProjectSecret(
				context.project,
				input.name,
				input.value,
				context.session.user.id,
			),
		),
	removeSecret: projectProcedure(
		projectInput.extend({ name: secretNameSchema }),
		permitted(SAVING),
	)
		.route({ summary: "Removes a secret of a project." })
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.connections.removeProjectSecret(
				context.project,
				input.name,
				context.session.user.id,
			),
		),
	/**
	 * Moves a project secret to this computer or to the owner's Personal
	 * secrets (ADR 13, decision 7). It is saved there first: the project's
	 * copy goes only after that.
	 */
	moveSecretOut: projectProcedure(
		projectInput.extend({ name: secretNameSchema, to: secretScopeSchema }),
		ownerSaving,
	)
		.route({
			summary:
				"Moves a secret of a project to this computer, or to its owner's Personal secrets.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.connections.moveFromProject(
				context.project,
				input.name,
				input.to,
				context.session.user.id,
			),
		),
	/**
	 * Moves a saved secret of this computer, or a Personal one, into a
	 * project of the session's Space. It is saved in the project first:
	 * the old copy goes only after that.
	 */
	moveSecretIn: projectProcedure(
		projectInput.extend({ name: secretNameSchema, from: secretScopeSchema }),
		ownerSaving,
	)
		.route({
			summary:
				"Moves a secret of this computer, or a Personal one, into a project of the Space.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.connections.moveToProject(
				input.name,
				input.from,
				context.project,
				context.session.user.id,
			),
		),
	/**
	 * The secrets of the session's Space (ADR 18): every step of a run in the
	 * Space can use them, on any device. The same rules as a project's.
	 */
	spaceSecrets: protectedProcedure
		.route({
			summary:
				"Lists the secrets of the Space, with who set each, when, and the flows that use it.",
		})
		.output(output(projectSecretListSchema))
		.handler(async ({ context }) => {
			const canChange = await context.access.can(SAVING);
			let listed: Awaited<ReturnType<typeof context.connections.spaceSecrets>>;
			try {
				listed = await context.connections.spaceSecrets(
					context.spaceId,
					context.session.user.id,
				);
			} catch (error) {
				if (!unreachable(error)) throw error;
				return { secrets: [], available: false, canChange };
			}
			const use = await context.space.flowUse();
			const connections = context.connections.list();
			const { toolsBySecret, toolFlows } = cliToolsOfSecrets(context, use);
			const names = (flows: readonly { flowName: string }[]) =>
				flows.map((f) => f.flowName);
			return {
				secrets: listed.map((secret) => {
					const tools = toolsBySecret.get(secret.name) ?? [];
					return {
						...secret,
						flows: [
							...new Set([
								...names(use.secrets.get(secret.name) ?? []),
								...connections
									.filter((c) =>
										c.variables.some((v) => v.name === secret.name),
									)
									.flatMap((c) => names(use.connections.get(c.name) ?? [])),
								...tools.flatMap((tool) => names(toolFlows.get(tool) ?? [])),
							]),
						].sort(),
						tools: [...tools].sort(),
						webhooks: [
							...new Set(names(use.webhooks.get(secret.name) ?? [])),
						].sort(),
					};
				}),
				available: true,
				canChange,
			};
		}),
	setSpaceSecret: permitted(SAVING)
		.route({
			summary:
				"Saves a secret of the Space, or replaces its value. The value never comes back.",
		})
		.output(output(z.void()))
		.input(z.object({ name: secretNameSchema, value: z.string().min(1) }))
		.handler(async ({ context, input }) =>
			context.connections.setSpaceSecret(
				context.spaceId,
				input.name,
				input.value,
				context.session.user.id,
			),
		),
	removeSpaceSecret: permitted(SAVING)
		.route({ summary: "Removes a secret of the Space." })
		.output(output(z.void()))
		.input(z.object({ name: secretNameSchema }))
		.handler(async ({ context, input }) =>
			context.connections.removeSpaceSecret(
				context.spaceId,
				input.name,
				context.session.user.id,
			),
		),
	/** Moves a secret of this computer, or a Personal one, into the session's Space. */
	moveSecretToSpace: ownerSaving
		.route({
			summary:
				"Moves a secret of this computer, or a Personal one, into the Space.",
		})
		.output(output(z.void()))
		.input(z.object({ name: secretNameSchema, from: secretScopeSchema }))
		.handler(async ({ context, input }) =>
			context.connections.moveToSpace(
				input.name,
				input.from,
				context.spaceId,
				context.session.user.id,
			),
		),
	/** Moves a secret of the Space to this computer, or to the owner's Personal secrets. */
	moveSecretFromSpace: ownerSaving
		.route({
			summary:
				"Moves a secret of the Space to this computer, or to its owner's Personal secrets.",
		})
		.output(output(z.void()))
		.input(z.object({ name: secretNameSchema, to: secretScopeSchema }))
		.handler(async ({ context, input }) =>
			context.connections.moveFromSpace(
				context.spaceId,
				input.name,
				input.to,
				context.session.user.id,
			),
		),
	/**
	 * Moves a secret saved on another of the owner's devices into a project
	 * of the session's Space (ADR 13, decision 7). That device reads its own
	 * value, saves it in the project, then removes its copy: the value never
	 * passes through this computer. Refused while that device is offline.
	 */
	moveSecretFromDevice: projectProcedure(
		projectInput.extend({
			name: secretNameSchema,
			deviceId: z.string().min(1).max(64),
		}),
		ownerSaving,
	)
		.route({
			summary:
				"Moves a secret saved on another of your devices into a project of the Space. That device moves its own value.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.devices.moveSecretOn(input.deviceId, input.name, {
				to: "project",
				...context.project,
			}),
		),
};
