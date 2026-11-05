import { delimiter } from "node:path";
import { harnessNoun } from "@nightshift/agents/harness-facts";
import type {
	AgentHarness,
	AgentSessionInput,
	Decider,
	DeciderName,
	DecisionInput,
	DecisionResult,
	HarnessName,
	SessionContribution,
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
import { findProgram, foldContributions } from "@nightshift/agents/types";
import {
	type AgentHarnessName,
	type AgentNode,
	type CustomHarnessName,
	deciderNameSchema,
	type FlowSources,
	isCustomHarness,
	type ProfileSettings,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

import type { ArtifactStore } from "../artifacts";
import {
	type CliToolGuide,
	cliToolsInstruction,
	type McpExpansion,
	type SecretEnv,
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
import { spawnCommand } from "./command";
import { redactExec, redactSession } from "./redact";
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
	type SessionEvent,
	type SessionInput,
	type ToolResult,
} from "./types";

/**
 * Everything on this computer a step body may touch: the harnesses, the
 * decider, the MCP connections with their secrets, the CLI tools, `sh -c`
 * and git worktrees. `createDaemon` (`@nightshift/daemon`) wires it from the daemon's stores; a
 * test wires it over fakes.
 */
export type LocalDeviceDeps = {
	id: string;
	name: string;
	/** The harnesses built on this computer, by name. */
	harnesses: Partial<Record<HarnessName, AgentHarness>>;
	/**
	 * The custom agents added on this computer (`acp:<slug>`), read at each
	 * question. Undefined: none of that name. `use`: which secret scopes
	 * its environment may read.
	 */
	customHarness?: (
		name: CustomHarnessName,
		use?: SecretUse,
	) => AgentHarness | undefined;
	/**
	 * The harnesses added on the Agents page, read at each question. A
	 * harness left out cannot run a session, even when `harnesses` has it.
	 * Without it: every harness in `harnesses`. Custom agents need no entry.
	 */
	harnessNames?: () => ReadonlySet<HarnessName>;
	/** The custom agents added on this computer, by flow name. Without it: none. */
	customHarnessNames?: () => readonly CustomHarnessName[];
	/** Decides Decision nodes and makes values for Value nodes. */
	decider?: Decider;
	/**
	 * An Agent node's MCP servers: its connections, with `${NAME}`
	 * expanded. Default: none, and a node with connections is refused.
	 * `use`: which secret scopes they may read (none Personal under an Offer).
	 */
	mcpServersFor?: (
		node: Pick<AgentNode, "connections">,
		use?: SecretUse,
	) => Promise<McpExpansion>;
	/**
	 * A Command node's secrets, by name: the run's Project, Personal, then
	 * the keychain, then the daemon's environment. Default: `process.env`.
	 * `use`: which scopes they may read.
	 */
	secretEnv?: (names: readonly string[], use?: SecretUse) => Promise<SecretEnv>;
	/** The connections defined on this computer. */
	connectionNames?: () => ReadonlySet<string>;
	/** The CLI tools defined on this computer. */
	cliNames?: () => ReadonlySet<string>;
	/** Where a program is on this computer, or null. Default: `findProgram`. */
	findCli?: (name: string) => string | null;
	/**
	 * What an agent learns about its CLI tools: each description and help.
	 * A new session gets them after its prompt. Without it, nothing.
	 */
	cliToolsFor?: (names: readonly string[]) => Promise<CliToolGuide[]>;
	/**
	 * The CLI tools' launchers and logins (`createToolLaunchers`). Without
	 * it, a tool runs the program of its name with this computer's sign-in.
	 */
	toolLaunchers?: Pick<ToolLaunchers, "prepare" | "forCommand" | "guarded">;
	/*
	 * Every secret this Device reads for a step goes through `mcpServersFor`,
	 * `secretEnv`, `toolLaunchers`, `customHarness`, the decider and
	 * `secretValues`: the scopes of ADR 13 are the store's, not this file's.
	 */
	/**
	 * The folder of a project's Clone on this computer, or null when it has
	 * none. Without it, this computer has no Clones: a run cannot start here.
	 */
	clonePath?: (projectId: string) => Promise<string | null>;
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
	/** A profile defined on this computer, by its id, or null. */
	profileFor?: (id: string) => ProfileSettings | null;
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
};

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

/**
 * Which secret scopes a step's use reads (ADR 13): its run's Project
 * first, and no Personal secret under an Offer.
 */
function secretUse(run: StepRun | undefined, underOffer?: true): SecretUse {
	return {
		...(underOffer ? { personal: false } : {}),
		...(run ? { project: run } : {}),
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
): string {
	const [noun, isNot, it] =
		missing.length === 1
			? ["secret", "it is", "it"]
			: ["secrets", "they are", "them"];
	return `The command needs the ${noun} ${missing.join(", ")}, but ${isNot} not saved. Save ${it} on the Secrets page, or remove ${it} from the node.${unreachableNote(found)}`;
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
	} = createWorktrees(git);
	const snapshots = deps.snapshots ? createWorktreeSnapshots(git) : null;
	const findCli = deps.findCli ?? ((name: string) => findProgram(name));
	const mcpServersFor =
		deps.mcpServersFor ??
		(async (
			node: Pick<AgentNode, "connections">,
			_use?: SecretUse,
		): Promise<McpExpansion> =>
			(node.connections ?? []).length > 0
				? {
						ok: false,
						message: `The node uses connections (${node.connections?.join(", ")}), but there are none. Add them under Agents → Tools.`,
					}
				: { ok: true, servers: {} });
	const secretEnv =
		deps.secretEnv ??
		(async (names: readonly string[], _use?: SecretUse): Promise<SecretEnv> => {
			const missing = names.filter((name) => process.env[name] === undefined);
			if (missing.length > 0) return { ok: false, missing };
			return {
				ok: true,
				env: Object.fromEntries(
					names.map((name) => [name, process.env[name] ?? ""]),
				),
			};
		});

	/** The harness of that name, when it is added and built. */
	const harnessFor = (
		name: AgentHarnessName,
		use?: SecretUse,
	): AgentHarness | undefined => {
		if (isCustomHarness(name)) return deps.customHarness?.(name, use);
		return (deps.harnessNames?.().has(name) ?? true)
			? harnesses[name]
			: undefined;
	};

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
			connections,
			clis,
			artifacts,
			knowledge: _knowledge,
			knowledgeOnly: _knowledgeOnly,
			files,
			underOffer,
			run,
			...rest
		} = input;
		// Another Person's step under an Offer reads no Personal secret of
		// this computer's owner (ADR 13, decision 5). A step of a run reads
		// its Project's secrets first.
		const use = secretUse(run, underOffer);
		const harness = harnessFor(name, use);
		if (!harness) {
			yield {
				type: "refused",
				message: `No ${harnessNoun(name)} is added. Add it under Agents.`,
			};
			return;
		}
		// `${NAME}` in env values and headers reads Personal, then the
		// keychain, then the environment. The values go to the harness only,
		// never into the log.
		const mcp = await mcpServersFor(connections ? { connections } : {}, use);
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
				!input.resumeSessionId && withClis && deps.cliToolsFor
					? cliToolsInstruction(await deps.cliToolsFor(clis))
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
	 * `sh -c` here. A command's secrets read the keychain, then the
	 * environment, on this computer: one it does not have refuses the
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
				? await secretEnv(secrets, secretUse(run))
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
			tools = (await deps.toolLaunchers?.forCommand(secretUse(run))) ?? null;
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
				harnesses: [
					...(Object.keys(harnesses) as HarnessName[]),
					...(deps.customHarnessNames?.() ?? []),
				].filter((name) => harnessFor(name) !== undefined),
				connections: [...(deps.connectionNames?.() ?? [])],
				clis: [...(deps.cliNames?.() ?? [])],
				programs: Object.fromEntries(
					(query.programs ?? []).map((name) => [name, findCli(name)]),
				),
				profiles: Object.fromEntries(
					(query.profiles ?? []).flatMap((id) => {
						const profile = deps.profileFor?.(id) ?? null;
						return profile ? [[id, profile]] : [];
					}),
				),
				decider: deciderFacts,
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
			const mcp = await mcpServersFor(
				{ connections: [call.connection] },
				secretUse(run),
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
