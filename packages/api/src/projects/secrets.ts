import type { Permissions } from "@nightshift/auth";
import {
	cliToolsOfSecrets,
	type FlowRef,
	HostUnreachableError,
	useThroughProfiles,
} from "@nightshift/engine";
import { secretNameSchema } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { z } from "zod";

import { secretScopeSchema } from "../config";
import type { Context } from "../context";
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

/**
 * What uses each secret of a project or of the Space, by its name: the
 * flows that use it, and the CLI tools whose logins read it. A flow uses
 * it through its nodes or a flow or kit it calls, through a connection
 * that reads it, through a CLI tool whose login reads it, or through a
 * Model Profile whose address reads it. A flow uses a connection or a CLI
 * tool when it names it, or when an Agent Profile it uses names it. The
 * connections and the profiles are this computer's.
 */
function secretUsers(
	context: Pick<Context, "connections" | "cliTools" | "profiles" | "daemon">,
	use: Parameters<typeof cliToolsOfSecrets>[1],
): {
	flows: (secret: string) => FlowRef[];
	tools: (secret: string) => readonly string[];
	webhooks: (secret: string) => readonly FlowRef[];
} {
	const deviceId = context.daemon.device.id;
	const through = useThroughProfiles(context, use, deviceId);
	const { toolsBySecret, toolFlows } = cliToolsOfSecrets(
		context,
		use,
		deviceId,
	);
	const connections = context.connections.list();
	return {
		flows: (secret) => {
			const tools = toolsBySecret.get(secret) ?? [];
			return [
				...(use.secrets.get(secret) ?? []),
				...(through.secrets.get(secret) ?? []),
				...connections
					.filter((c) => c.variables.some((v) => v.name === secret))
					.flatMap((c) => [
						...(use.connections.get(c.name) ?? []),
						...(through.connections.get(c.name) ?? []),
					]),
				...tools.flatMap((tool) => toolFlows.get(tool) ?? []),
			];
		},
		tools: (secret) => toolsBySecret.get(secret) ?? [],
		webhooks: (secret) => use.webhooks.get(secret) ?? [],
	};
}

/** The names of the flows among `flows`, each once and sorted: of one project, when it is given. */
function flowNames(flows: readonly FlowRef[], projectId?: string): string[] {
	return [
		...new Set(
			flows
				.filter((f) => projectId === undefined || f.projectId === projectId)
				.map((f) => f.flowName),
		),
	].sort();
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
			const users = secretUsers(context, await context.space.flowUse());
			return {
				secrets: listed.map((secret) => ({
					...secret,
					flows: flowNames(users.flows(secret.name), at.projectId),
					tools: [...users.tools(secret.name)].sort(),
					webhooks: flowNames(users.webhooks(secret.name), at.projectId),
				})),
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
			const users = secretUsers(context, await context.space.flowUse());
			return {
				secrets: listed.map((secret) => ({
					...secret,
					flows: flowNames(users.flows(secret.name)),
					tools: [...users.tools(secret.name)].sort(),
					webhooks: flowNames(users.webhooks(secret.name)),
				})),
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
