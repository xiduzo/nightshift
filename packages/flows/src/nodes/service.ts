import { z } from "zod";
import {
	holdScopeSchema,
	type NodeCheck,
	nodeBase,
	placed,
	secretNameSchema,
} from "./base";

/**
 * The Service node (ADR 9): it starts a process that keeps running while
 * the steps after it work, such as a Docker Compose stack, a dev server or
 * a local model server. The engine stops it when the run leaves the
 * node's scope, whatever ends it.
 */

/**
 * When the service is ready: a `command` that exits 0, or a `url` that
 * answers with a 2xx status. Exactly one of the two (the validator checks
 * it). Tried every `everySeconds` (default 2), up
 * to `timeoutMinutes` (default 5).
 */
export const serviceReadySchema = z.object({
	/**
	 * Run with `sh -c` in the worktree, as a Command. Exit 0: ready. JSON
	 * written to `$NS_OUTPUT` is the step's `data`
	 * (`{{stack.data.url}}`).
	 */
	command: z.string().min(1).optional(),
	/** A template: `http://127.0.0.1:8080/health`. */
	url: z.string().min(1).optional(),
	everySeconds: z.number().int().positive().optional(),
	timeoutMinutes: z.number().int().positive().optional(),
});
export type ServiceReady = z.infer<typeof serviceReadySchema>;

/**
 * Starts `start` in the background in the worktree, in its own process
 * group, and waits until `ready` says the service is ready.
 *
 * Outcomes: `ready`, and `failed` when the service ends before it is
 * ready or is not ready in time. Then the engine stops it.
 *
 * The service lives for its `scope`: the run (the default), or the
 * Section with that id, which holds the node. When the run leaves the
 * scope, and on every end of the run, the engine stops it: with `stop`
 * when the node has one (`docker compose down`), else by ending the
 * process group. A resumed run inside the scope starts it again.
 *
 * Template values reach the commands as environment variables, as on a
 * Command node. `secrets` reach `start`, the ready command and `stop`.
 * Every step in the scope must run on the service's Device.
 */
export const serviceNodeSchema = z.object({
	...nodeBase,
	...placed,
	type: z.literal("service"),
	/** The command that starts the service: `docker compose up -d`, `bun run dev`. */
	start: z.string().min(1),
	ready: serviceReadySchema,
	/** The command that stops the service. Unset: the engine ends its process group. */
	stop: z.string().min(1).optional(),
	/** Until when the service runs. Unset: `run`. */
	scope: holdScopeSchema.optional(),
	/** Secrets by name, as on a Command node. */
	secrets: z.array(secretNameSchema).optional(),
});
export type ServiceNode = z.infer<typeof serviceNodeSchema>;

/** How often a probe tries when its node sets no `everySeconds`. */
export const DEFAULT_SERVICE_EVERY_SECONDS = 2;
/** How long a probe tries when its node sets no `timeoutMinutes`. */
export const DEFAULT_SERVICE_TIMEOUT_MINUTES = 5;

/** The outcomes of a Service node, in the order its handles show. */
export const serviceOutcomes = ["ready", "failed"] as const;

/**
 * data: the JSON the ready command wrote to `$NS_OUTPUT`. log_tail: the
 * last lines of the service's log, as they are when a later step reads
 * them.
 */
export const serviceOutputFields = [
	"outcome",
	"data",
	"log_tail",
	"visit",
] as const;

/** The Section a Service node lives for, or null for the run. */
export function serviceSection(node: ServiceNode): string | null {
	return typeof node.scope === "object" ? node.scope.section : null;
}

/**
 * A Service node's templates read known names, it names each secret once,
 * and a Section scope names a Section of the flow that holds the node. Its
 * wait is `ready.timeoutMinutes`: the node has no timeout of its own.
 */
export function checkServiceNode(node: ServiceNode, check: NodeCheck): void {
	check.template(node.start, "start command");
	if ((node.ready.command === undefined) === (node.ready.url === undefined)) {
		check.error(
			`Service node "${node.id}" needs one ready check: a command or a URL.`,
		);
	}
	if (node.ready.command !== undefined) {
		check.template(node.ready.command, "ready command");
	}
	if (node.ready.url !== undefined) check.template(node.ready.url, "ready URL");
	if (node.stop !== undefined) check.template(node.stop, "stop command");
	const secrets = new Set<string>();
	for (const name of node.secrets ?? []) {
		if (secrets.has(name)) {
			check.error(
				`Service node "${node.id}" names the secret ${name} more than once.`,
			);
		}
		secrets.add(name);
	}
	const section = serviceSection(node);
	if (section !== null) {
		const nodes = check.section(section);
		if (nodes === null) {
			check.error(
				`Service node "${node.id}" runs until the run leaves the Section "${section}", but the flow has no such Section. Pick a Section, or run the service for the whole run.`,
			);
		} else if (!nodes.includes(node.id)) {
			check.error(
				`Service node "${node.id}" runs for the Section "${section}", but it is not in that Section. Move the node into the Section, or pick the Section it is in.`,
			);
		}
	}
	if (node.timeoutMinutes !== undefined) {
		check.warning(
			`Service node "${node.id}" does not use its timeout. Set how long it waits for the service with ready.timeoutMinutes.`,
		);
	}
}
