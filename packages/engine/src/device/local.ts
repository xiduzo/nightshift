import { stat } from "node:fs/promises";
import { delimiter } from "node:path";
import { harnessNoun } from "@nightshift/agents/harness-facts";
import type {
	AgentHarness,
	AgentSessionInput,
	Decider,
	DeciderName,
	DecisionInput,
	DecisionResult,
	SessionContribution,
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
import { findProgram, foldContributions } from "@nightshift/agents/types";
import {
	type AgentHarnessName,
	deciderNameSchema,
	FLOW_VERSION,
	type FlowSources,
	type JsonValue,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

import type { ArtifactStore } from "../artifacts";
import {
	type CliToolStore,
	type ConnectionStore,
	cliToolsInstruction,
	type ProfileStore,
	type SecretUse,
	type StepRun,
	unreachableNote,
} from "../device-config";
import type { Knowledge } from "../knowledge";
import {
	checkProjectFolder,
	createWorktreeSnapshots,
	createWorktrees,
	type Git,
	NOT_ON_THIS_COMPUTER,
	systemGit,
} from "../projects";
import type { RunFolders } from "../run-folders";
import { spawnCommand } from "./command";
import { readFolderFile } from "./read-file";
import { redactExec, redactSession, redactText } from "./redact";
import { callServerTool } from "./tool-call";
import type { ToolLaunchers } from "./tool-launchers";
import {
	type AddressCheck,
	addressKey,
	type Capabilities,
	type DeciderFacts,
	type Device,
	type ExecEvent,
	type ExecInput,
	type OfferedSessionInput,
	type RequestText,
	type SessionEvent,
	type SessionInput,
	type ToolResult,
	type WebRequestInput,
	type WebRequestResult,
} from "./types";
import { type OutgoingRequest, sendRequest } from "./web-request";

/** What the Device reads of this computer's connections and secrets. */
export type DeviceConnections = Pick<
	ConnectionStore,
	"names" | "mcpServersFor" | "secretEnv"
>;

/** What the Device reads of this computer's CLI tools. */
export type DeviceCliTools = Pick<CliToolStore, "names" | "program" | "guides">;

/**
 * The agent harnesses of this computer, read at each question: the ones
 * added on the Agents page, and the custom agents (`acp:<slug>`). The
 * daemon reads them from its settings (`localHarnesses` of
 * `@nightshift/daemon`), a test from a record (`harnessesOf`).
 */
export type Harnesses = {
	/**
	 * The harness of that name, when it is added and built here. Undefined:
	 * none of that name. `use`: where the session happens, for the Secret
	 * scope rule of a custom agent's env.
	 */
	get(name: AgentHarnessName, use?: SecretUse): AgentHarness | undefined;
	/** The names `get` finds: the harnesses this Device reports. */
	names(): readonly AgentHarnessName[];
};

/**
 * Everything on this computer a step body may touch: the harnesses, the
 * decider, this computer's configuration as its stores (connections and
 * secrets, CLI tools, Agent Profiles), `sh -c` and git worktrees.
 * `createDaemon` (`@nightshift/daemon`) wires it from the daemon's stores;
 * a test wires it over the same stores, or fakes of them.
 */
export type LocalDeviceDeps = {
	id: string;
	name: string;
	/** The harnesses added on this computer. */
	harnesses: Harnesses;
	/** Decides Decision nodes and makes values for Value nodes. */
	decider?: Decider;
	/**
	 * Who answers for Night Shift's own Decider and Brief writer here, from
	 * this computer's settings. Read on each `capabilities` call.
	 */
	builtinModels?: () => NonNullable<DeciderFacts["builtin"]>;
	/**
	 * This computer's connections and secrets (`ConnectionStore`): an Agent
	 * node's MCP servers with `${NAME}` expanded, a Command node's secrets
	 * by name, from the scopes of the use (`secretScopes`). Without it:
	 * no connections, and a node with connections is refused; a command's
	 * secrets come from `process.env`.
	 */
	connections?: DeviceConnections;
	/**
	 * This computer's CLI tools (`CliToolStore`): their names, the program
	 * each runs, and what an agent learns about them (each description and
	 * help, after a new session's prompt). Without it: none is defined,
	 * and a tool runs the program of its name.
	 */
	cliTools?: DeviceCliTools;
	/** This computer's Agent Profiles (`ProfileStore`), by id. Without it: none. */
	profiles?: Pick<ProfileStore, "settingsFor">;
	/** Where a program is on this computer, or null. Default: `findProgram`. */
	which?: (program: string) => string | null;
	/**
	 * The CLI tools' launchers and logins (`createToolLaunchers`). Without
	 * it, a tool runs the program of its name with this computer's sign-in.
	 */
	toolLaunchers?: Pick<ToolLaunchers, "prepare" | "forCommand" | "guarded">;
	/*
	 * Every secret this Device reads for a step goes through `connections`,
	 * `toolLaunchers`, `harnesses`, the decider and `secretValues`.
	 * Which scopes each reads is the Secret scope rule's (`secretScopes`),
	 * not this file's: it passes the facts of the use on.
	 */
	/**
	 * The folder of a project's Clone on this computer, or null when it has
	 * none. Without it, this computer has no Clones: a run cannot start here.
	 */
	clonePath?: (projectId: string) => Promise<string | null>;
	/**
	 * The runs' own folders on this computer (ADR 22): a run of a project
	 * without a folder works in its folder here. Without it, this computer
	 * cannot run such a project.
	 */
	runFolders?: Pick<RunFolders, "make">;
	/**
	 * The project's flows: its flow document (ADR 2), for a Walker of an
	 * older Night Shift that asks this Device for them. Without it: none.
	 */
	flows?: (projectId: string) => Promise<FlowSources>;
	/**
	 * The git port: worktrees, Hand-offs and item branches, and finding git
	 * before a worktree is added. Default: the git programs on this computer.
	 */
	git?: Git;
	/**
	 * Whether this computer takes snapshots of a run's worktree, over the
	 * git port, to tell what a step changed there (`snapshotWorktree`,
	 * `worktreeChanges`). The daemon's does. Without it, it has neither.
	 */
	snapshots?: boolean;
	/**
	 * Where a session keeps its artifacts, and reads the files of the run's
	 * answers. Without it, sessions keep none and get none.
	 */
	artifacts?: Pick<ArtifactStore, "save" | "answerFolder">;
	/**
	 * The projects' knowledge on this computer, in step with their Spaces
	 * (ADR 4). A step that asks for it gets it here, and gives it back when
	 * it ends. Without it, a step gets none.
	 */
	knowledge?: Pick<Knowledge, "forCommand" | "forSession">;
	/**
	 * What a run step's harness session adds to its environment, read as
	 * the session starts: the export to monitoring gives Claude Code its
	 * own telemetry under the step (`@nightshift/telemetry`). `values` are
	 * the secret values in `env` (an API key in its headers): the session's
	 * output has them as `•••`. `config`: the harness's own `--config`
	 * overrides (Codex sets its telemetry there). Without it, or when it
	 * gives nothing: nothing.
	 */
	sessionEnv?: (session: {
		harness: AgentHarnessName;
		runId: string;
		stepId: string;
	}) => {
		env: Record<string, string>;
		values: readonly string[];
		config?: Record<string, string>;
	};
	/**
	 * The values of the saved secrets (Personal ones too, when `use`
	 * allows them) and of the ones the connections reference, read as a
	 * session starts: its output has each as `•••`, as an exported run has.
	 * Without it: only the values the session was given (its CLI tools'
	 * logins, its MCP servers' and `sessionEnv`'s).
	 */
	secretValues?: (use?: SecretUse) => Promise<readonly string[]>;
	/**
	 * Whether a web request from this computer may reach loopback and
	 * private addresses (`web-addresses.ts`), read at each request. A
	 * Host's Settings decide it there. Without it: they may, as on a laptop.
	 */
	privateNetwork?: () => boolean;
	/** The addresses of a host name, for a test. Default: the system's resolver. */
	resolve?: (hostname: string) => Promise<string[]>;
};

/** The run's own folder here, as the Device port answers it: no branch, no base. */
function runFolderOf(
	runFolders: Pick<RunFolders, "make">,
): NonNullable<Device["runFolder"]> {
	return async (run) => {
		const { path, made } = await runFolders.make(run.id);
		return { worktreePath: path, branch: "", baseRef: "", made };
	};
}

/** What an agent learns about the files a person added to the run's answers. */
function answerFilesInstruction(paths: readonly string[]): string {
	return [
		"The person added files to their answers in this run. Read the ones your task needs:",
		...paths.map((path) => `- ${path}`),
	].join("\n");
}

/** What `decide` answers on a Device without a decider (or one that makes no values). */
function noDecider(
	makes: "decision" | "value",
): Extract<DecisionResult, { kind: "error" }> {
	return {
		kind: "error",
		errorKind: "harness",
		message: `No decider is configured for ${makes === "value" ? "Value" : "Decision"} nodes.`,
		costUsd: null,
	};
}

/** A Device without connections: a node with connections is refused, and a command's secrets come from the environment. */
const NO_CONNECTIONS: DeviceConnections = {
	names: () => new Set(),
	async mcpServersFor(node, _use) {
		return (node.connections ?? []).length > 0
			? {
					ok: false,
					message: `The node uses connections (${node.connections?.join(", ")}), but there are none. Add them under Agents → Tools.`,
				}
			: { ok: true, servers: {} };
	},
	async secretEnv(names, _use) {
		const missing = names.filter((name) => process.env[name] === undefined);
		if (missing.length > 0) return { ok: false, missing };
		return {
			ok: true,
			env: Object.fromEntries(
				names.map((name) => [name, process.env[name] ?? ""]),
			),
		};
	},
};

/** The facts of a step's use of secrets, for the Secret scope rule (`secretScopes`). */
function useOf(run: StepRun | undefined, underOffer?: true): SecretUse {
	return {
		...(run ? { run } : {}),
		...(underOffer ? { underOffer } : {}),
	};
}

/** Whether a command's text names a CLI tool, as a word of its own. */
function namesTool(command: string, tool: string): boolean {
	const name = tool.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);
	return new RegExp(`(^|[^\\w.-])${name}($|[^\\w.-])`).test(command);
}

/**
 * Why a command does not start: secrets it names that this computer does
 * not have, and why when the Personal secrets could not be read.
 */
function missingSecretsMessage(
	missing: readonly string[],
	found: Parameters<typeof unreachableNote>[0] = {},
	subject = "The command",
): string {
	const [noun, isNot, it] =
		missing.length === 1
			? ["secret", "it is", "it"]
			: ["secrets", "they are", "them"];
	return `${subject} needs the ${noun} ${missing.join(", ")}, but ${isNot} not saved. Save ${it} on the Secrets page, or remove ${it} from the node.${unreachableNote(found)}`;
}

/** The secrets a request names, each once. */
function requestSecretNames(
	input: Omit<WebRequestInput, "signal" | "run">,
): string[] {
	const texts: RequestText[] = [
		input.url,
		...(input.query ?? []).map((field) => field.value),
		...(input.headers ?? []).map((field) => field.value),
		...(input.body === undefined
			? []
			: input.body.kind === "text"
				? [input.body.text]
				: input.body.fields.map((field) => field.value)),
	];
	return [
		...new Set(
			texts.flatMap((text) =>
				text.flatMap((part) => ("secret" in part ? [part.secret] : [])),
			),
		),
	];
}

/** A request text with its secrets filled in. */
function filled(text: RequestText, env: Record<string, string>): string {
	return text
		.map((part) => {
			if ("text" in part) return part.text;
			const value = env[part.secret] ?? "";
			return part.escape === "json"
				? JSON.stringify(value).slice(1, -1)
				: value;
		})
		.join("");
}

/** Whether a text holds a secret. */
function holdsSecret(text: RequestText): boolean {
	return text.some((part) => "secret" in part);
}

/** The request as it goes out: every secret filled in, the query on the URL, the form encoded. */
function outgoing(
	input: Omit<WebRequestInput, "run">,
	env: Record<string, string>,
): OutgoingRequest {
	let url = filled(input.url, env);
	const query = (input.query ?? []).map(
		(field) => [field.name, filled(field.value, env)] as [string, string],
	);
	if (query.length > 0) {
		try {
			const parsed = new URL(url);
			for (const [name, value] of query)
				parsed.searchParams.append(name, value);
			url = parsed.toString();
		} catch {
			// Not a URL: `sendRequest` refuses it.
		}
	}
	const body = input.body;
	return {
		method: input.method,
		url,
		headers: (input.headers ?? []).map((field) => ({
			name: field.name,
			value: filled(field.value, env),
			secret: holdsSecret(field.value),
		})),
		...(body === undefined
			? {}
			: body.kind === "text"
				? {
						body: {
							contentType: body.contentType,
							text: filled(body.text, env),
						},
					}
				: {
						body: {
							contentType: "application/x-www-form-urlencoded",
							text: new URLSearchParams(
								body.fields.map((field): [string, string] => [
									field.name,
									filled(field.value, env),
								]),
							).toString(),
						},
					}),
		timeoutMs: input.timeoutMs,
		maxBytes: input.maxBytes,
		showHost: !holdsSecret(input.url),
		signal: input.signal,
	};
}

/** The result with the secret values in `values` masked: its messages, headers and body. */
function redactRequest(
	result: WebRequestResult,
	values: readonly string[],
): WebRequestResult {
	if (values.length === 0) return result;
	if (result.kind !== "answered") {
		return { ...result, message: redactText(result.message, values) };
	}
	const { response } = result;
	return {
		kind: "answered",
		response: {
			...response,
			statusText: redactText(response.statusText, values),
			headers: Object.fromEntries(
				Object.entries(response.headers).map(([name, value]) => [
					name,
					redactText(value, values),
				]),
			),
			body: redactJson(response.body, values),
		},
	};
}

/** Every string of a JSON value, keys included, with the secret values masked. */
function redactJson(value: JsonValue, values: readonly string[]): JsonValue {
	if (typeof value === "string") return redactText(value, values);
	if (Array.isArray(value))
		return value.map((item) => redactJson(item, values));
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				redactText(key, values),
				redactJson(item, values),
			]),
		);
	}
	return value;
}

/** The session's `saveArtifact`: copies the file and tells the agent it is kept. */
function keepArtifact(
	store: Pick<ArtifactStore, "save">,
	step: { runId: string; stepId: string },
	cwd: string,
): NonNullable<AgentSessionInput["saveArtifact"]> {
	return async (file) => {
		const artifact = await store.save({ ...step, cwd, ...file });
		return `Kept "${artifact.title}" as an artifact of this run.`;
	};
}

/** Asks each address once, from this computer: null when its server answers. */
async function checkAddresses(
	checks: readonly AddressCheck[],
	ask: NonNullable<Decider["checkAddress"]>,
): Promise<Record<string, string | null>> {
	const unique = new Map(checks.map((check) => [addressKey(check), check]));
	return Object.fromEntries(
		await Promise.all(
			[...unique].map(async ([key, check]) => [key, await ask(check)] as const),
		),
	);
}

/** This computer as a Device. */
export function localDevice(deps: LocalDeviceDeps): Device {
	const { harnesses, decider } = deps;
	const git = deps.git ?? systemGit();
	const {
		createAndCheckoutBranch,
		createWorktree,
		currentBranch,
		freeBranchName,
		pullRunBranch,
		pushRunBranch,
		restoreWorktree,
	} = createWorktrees(git);
	const snapshots = deps.snapshots ? createWorktreeSnapshots(git) : null;
	const which = deps.which ?? ((program: string) => findProgram(program));
	const { cliTools } = deps;
	/** Where the program of a CLI tool is: the tool's program, else the program of its name. */
	const findCli = (name: string) => which(cliTools?.program(name) ?? name);
	const connections: DeviceConnections = deps.connections ?? NO_CONNECTIONS;

	const deciderFacts: DeciderFacts | null = decider
		? {
				values: decider.value !== undefined,
				defaultModels: Object.fromEntries(
					deciderNameSchema.options.map((name) => [
						name,
						{
							decision: decider.defaultModel(name, "decision"),
							value: decider.defaultModel(name, "value"),
						},
					]),
				) as Record<DeciderName, { decision: string; value: string }>,
			}
		: null;

	async function* session(
		input: SessionInput | OfferedSessionInput,
	): AsyncGenerator<SessionEvent> {
		if ("offered" in input) {
			// Resolved by the Offer's guard before it reaches this computer.
			yield {
				type: "refused",
				message: `This device runs the profile "${input.offered.profile}" only through an Offer.`,
			};
			return;
		}
		const {
			harness: name,
			connections: _connections,
			clis,
			artifacts,
			knowledge: _knowledge,
			knowledgeOnly: _knowledgeOnly,
			files,
			underOffer,
			run,
			...rest
		} = input;
		// Where this session happens: the Secret scope rule decides what its
		// `${NAME}` references read (ADR 13, ADR 18).
		const use = useOf(run, underOffer);
		const harness = harnesses.get(name, use);
		if (!harness) {
			yield {
				type: "refused",
				message: `No ${harnessNoun(name)} is added. Add it under Agents.`,
			};
			return;
		}
		// `${NAME}` in env values and headers reads the scopes of `use`. The
		// values go to the harness only, never into the log.
		const mcp = await connections.mcpServersFor(
			input.connections ? { connections: input.connections } : {},
			use,
		);
		if (!mcp.ok) {
			yield { type: "refused", message: mcp.message };
			return;
		}
		// Plan mode runs no command: no CLI tools, no logins.
		const runsCommands = input.permissionMode !== "plan";
		const withClis = runsCommands && clis !== undefined && clis.length > 0;
		// Each CLI tool with a login runs through a launcher of this session.
		// The secrets the logins read go to the launchers only.
		const tools =
			withClis && deps.toolLaunchers
				? await deps.toolLaunchers.prepare(clis, use)
				: null;
		if (tools && !tools.ok) {
			yield { type: "refused", message: tools.message };
			return;
		}
		let known: Awaited<ReturnType<Knowledge["forSession"]>> | null = null;
		try {
			// A new session learns its CLI tools after the prompt. A resumed
			// session has them already.
			const guide =
				!input.resumeSessionId && withClis && cliTools
					? cliToolsInstruction(await cliTools.guides(clis))
					: "";
			const guarded = deps.toolLaunchers?.guarded() ?? [];
			// The knowledge as the Space has it now, before the agent reads it.
			known = deps.knowledge
				? await deps.knowledge.forSession(
						input,
						artifacts
							? { runId: artifacts.runId, stepId: artifacts.stepId }
							: {},
					)
				: null;
			const added = artifacts
				? deps.sessionEnv?.({ harness: name, ...artifacts })
				: undefined;
			// The files of the run's answers, in a folder the agent may read.
			const answers =
				artifacts && deps.artifacts && files && files.length > 0
					? await deps.artifacts.answerFolder(artifacts.runId, files)
					: null;
			// What each part adds to the session, in this order.
			const contributions: SessionContribution[] = [
				...(added ? [{ env: added.env }] : []),
				...(known ? [known.contribution] : []),
				...(answers
					? [
							{
								addDirs: [answers.dir],
								afterPrompt: answerFilesInstruction(answers.paths),
							},
						]
					: []),
				...(guide ? [{ afterPrompt: guide }] : []),
				...(tools?.env ? [{ env: tools.env }] : []),
			];
			yield { type: "ready", harness: name };
			const run = harness.run({
				...rest,
				...foldContributions(rest, contributions),
				...(clis && clis.length > 0 ? { clis } : {}),
				...(Object.keys(mcp.servers).length > 0
					? { mcpServers: mcp.servers }
					: {}),
				...(artifacts && deps.artifacts
					? {
							saveArtifact: keepArtifact(deps.artifacts, artifacts, rest.cwd),
						}
					: {}),
				...(tools?.toolsPath ? { toolsPath: tools.toolsPath } : {}),
				...(added?.config && Object.keys(added.config).length > 0
					? { harnessConfig: added.config }
					: {}),
				...(guarded.length > 0 ? { scrubEnv: guarded } : {}),
			});
			const events = known ? known.events(run) : run;
			// Every secret value the session could see comes back as `•••`.
			const hidden = [
				...(tools?.values ?? []),
				...(mcp.values ?? []),
				...(added?.values ?? []),
				...((await harness.secretValues?.().catch((error) => {
					console.warn("The agent's secrets were not read:", error);
					return [];
				})) ?? []),
				...((await deps.secretValues?.(use).catch((error) => {
					console.warn("The saved secrets were not read:", error);
					return [];
				})) ?? []),
			];
			yield* hidden.length > 0 ? redactSession(events, hidden) : events;
		} finally {
			await tools?.cleanup();
			// What the step changed, and the learnings it proposed, go to the Space.
			await known?.done();
		}
	}

	function decide(input: DecisionInput): Promise<DecisionResult>;
	function decide(input: ValueInput): Promise<ValueResult>;
	async function decide(
		input: DecisionInput | ValueInput,
	): Promise<DecisionResult | ValueResult> {
		if ("output" in input) {
			return decider?.value ? decider.value(input) : noDecider("value");
		}
		return decider ? decider.decide(input) : noDecider("decision");
	}

	/**
	 * `sh -c` here. A command's secrets come from the scopes of its use
	 * (`secretScopes`), on this computer: one it does not have refuses the
	 * command before it starts. Their values go to the command only; its
	 * output has them as `•••` before it leaves this computer.
	 *
	 * Each CLI tool with a login runs through its launcher, found first on
	 * PATH: `gh` in the command runs as the gh tool. The login's values go
	 * to the launcher only, and come back as `•••` too.
	 */
	async function* exec(input: ExecInput): AsyncGenerator<ExecEvent> {
		const { secrets = [], knowledge, run, ...command } = input;
		// The secrets of the CLI tools' logins go to their launchers only. A
		// command that names one in `secrets` gets it below.
		const scrub = (deps.toolLaunchers?.guarded() ?? []).filter(
			(name) => !secrets.includes(name),
		);
		const found =
			secrets.length > 0
				? await connections.secretEnv(secrets, useOf(run))
				: { ok: true as const, env: {} };
		if (!found.ok) {
			yield {
				type: "refused",
				message: missingSecretsMessage(found.missing, found),
			};
			return;
		}
		// The knowledge as the Space has it now, before the command reads it.
		// The sync flows write in its folder.
		const known =
			knowledge && deps.knowledge
				? await deps.knowledge.forCommand(knowledge.projectId)
				: null;
		let tools: Awaited<ReturnType<ToolLaunchers["forCommand"]>> | null = null;
		try {
			tools = (await deps.toolLaunchers?.forCommand(useOf(run))) ?? null;
			const leftOut = (tools?.leftOut ?? []).filter(({ tool }) =>
				namesTool(command.command, tool),
			);
			const env: Record<string, string> = {
				...known?.env,
				...command.env,
				...tools?.env,
				...found.env,
			};
			if (tools?.toolsPath) {
				env.PATH = [tools.toolsPath, command.env?.PATH ?? process.env.PATH]
					.filter(Boolean)
					.join(delimiter);
			}
			const hidden = [...Object.values(found.env), ...(tools?.values ?? [])];
			const events = spawnCommand({ ...command, env }, scrub);
			for await (const event of hidden.length > 0
				? redactExec(events, hidden)
				: events) {
				// Why the command failed, last in its output: a tool it names that
				// could not run.
				if (event.type === "exit" && event.exitCode !== 0) {
					for (const { message } of leftOut) {
						yield { type: "output", stream: "stderr", text: `${message}\n` };
					}
				}
				yield event;
			}
		} finally {
			await tools?.cleanup();
			// What the command changed, a sync's files, go to the Space.
			await known?.done();
		}
	}

	/** The folder of the project's Clone here; throws without one. */
	async function cloneOf(projectId: string): Promise<string> {
		const path = (await deps.clonePath?.(projectId)) ?? null;
		if (path === null) throw new Refusal("conflict", NOT_ON_THIS_COMPUTER);
		return path;
	}

	return {
		id: deps.id,
		name: deps.name,
		state: async () => ({ online: true }),
		async capabilities(query = {}): Promise<Capabilities> {
			return {
				elsewhere: null,
				harnesses: [...harnesses.names()],
				connections: [...connections.names()],
				clis: [...(cliTools?.names() ?? [])],
				programs: Object.fromEntries(
					(query.programs ?? []).map((name) => [name, findCli(name)]),
				),
				profiles: Object.fromEntries(
					(query.profiles ?? []).flatMap((id) => {
						const profile = deps.profiles?.settingsFor(id) ?? null;
						return profile ? [[id, profile]] : [];
					}),
				),
				decider: deciderFacts
					? { ...deciderFacts, builtin: deps.builtinModels?.() ?? {} }
					: null,
				requests: true,
				readFiles: true,
				flowVersion: FLOW_VERSION,
				testRuns: true,
				...(query.addresses?.length && decider?.checkAddress
					? {
							addresses: await checkAddresses(
								query.addresses,
								async (check) => (await decider.checkAddress?.(check)) ?? null,
							),
						}
					: {}),
			};
		},
		session,
		exec,
		async callTool(input): Promise<ToolResult> {
			const { run, ...call } = input;
			const mcp = await connections.mcpServersFor(
				{ connections: [call.connection] },
				useOf(run),
			);
			if (!mcp.ok) return { kind: "refused", message: mcp.message };
			const server = mcp.servers[call.connection];
			if (!server) {
				return {
					kind: "refused",
					message: `There is no connection named "${call.connection}". Add it under Agents → Tools, or pick another one.`,
				};
			}
			return callServerTool(server, call);
		},
		/**
		 * A web request from here. Its secrets come from the scopes of its
		 * use, as a command's do: one this computer does not have refuses it
		 * before anything is sent. Their values go to the request only, and
		 * come back masked in the answer and in every message.
		 */
		async request(input): Promise<WebRequestResult> {
			const { run, ...call } = input;
			const names = requestSecretNames(call);
			const found =
				names.length > 0
					? await connections.secretEnv(names, useOf(run))
					: { ok: true as const, env: {} };
			if (!found.ok) {
				return {
					kind: "refused",
					message: missingSecretsMessage(found.missing, found, "The request"),
				};
			}
			const result = await sendRequest(outgoing(call, found.env), {
				privateNetwork: deps.privateNetwork?.() ?? true,
				...(deps.resolve ? { resolve: deps.resolve } : {}),
			});
			return redactRequest(result, Object.values(found.env));
		},
		// A file is small and local: the signal is not needed here.
		readFile: ({ cwd, path, maxBytes }) =>
			readFolderFile({ cwd, path, maxBytes }),
		decide,
		flows: async (projectId) => deps.flows?.(projectId) ?? {},
		async worktree(run) {
			const repoPath = await cloneOf(run.projectId);
			const readiness = await checkProjectFolder(repoPath, { git });
			// A missing name for git or program of a knowledge source does not stop a run.
			const notReady = readiness.steps.find(
				(step) =>
					step.status === "failed" &&
					step.id !== "identity" &&
					step.id !== "tools",
			);
			if (notReady) {
				throw new Refusal(
					"conflict",
					`The project is not ready for runs. ${notReady.problem} ${
						notReady.id === "git"
							? "Install git, then start the run again."
							: "Add the project again to fix it."
					}`,
				);
			}
			return createWorktree({
				repoPath,
				shortId: run.id.slice(0, 8),
				...(run.baseRef !== undefined ? { baseRef: run.baseRef } : {}),
				...(run.author ? { author: run.author } : {}),
			});
		},
		async restoreWorktree({ run, cwd }) {
			// The copy is there: nothing to ask of the project's Clone.
			if ((await stat(cwd).catch(() => null))?.isDirectory()) return null;
			return restoreWorktree({
				repoPath: await cloneOf(run.projectId),
				shortId: run.id.slice(0, 8),
				was: cwd,
				baseRef: run.baseRef ?? "HEAD",
				...(run.author ? { author: run.author } : {}),
			});
		},
		...(deps.runFolders ? { runFolder: runFolderOf(deps.runFolders) } : {}),
		handOff: ({ cwd, runBranch }) => pushRunBranch(cwd, runBranch),
		async receiveHandOff({ run, branch, commit }) {
			return pullRunBranch({
				repoPath: await cloneOf(run.projectId),
				shortId: run.id.slice(0, 8),
				branch,
				commit,
				...(run.author ? { author: run.author } : {}),
			});
		},
		async itemBranch({ cwd, name, base, fallback }) {
			const from = base ?? (await currentBranch(cwd)) ?? fallback;
			const branch = await freeBranchName(cwd, name);
			await createAndCheckoutBranch(cwd, branch, from);
			return { branch, base: from };
		},
		// Each git command has its own time limit (`CHANGE_LIMITS`): the signal is not needed here.
		...(snapshots
			? {
					snapshotWorktree: async ({ cwd }) => ({
						tree: await snapshots.snapshotTree(cwd),
					}),
					async worktreeChanges({ cwd, from }) {
						const to = await snapshots.snapshotTree(cwd);
						return snapshots.treeChanges(cwd, from, to);
					},
				}
			: {}),
	};
}
