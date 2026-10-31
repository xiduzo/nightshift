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
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
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
} from "../device-config";
import {
	commandKnowledge,
	type KnowledgeFolders,
	type KnowledgeRequest,
	type KnowledgeSearch,
	type KnowledgeSync,
	keepLearnings,
	sessionKnowledge,
	sessionKnowledgeTools,
	withLearnings,
} from "../knowledge";
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
import type {
	Capabilities,
	DeciderFacts,
	Device,
	ExecEvent,
	ExecInput,
	OfferedSessionInput,
	SessionEvent,
	SessionInput,
	ToolResult,
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
	 * question. Undefined: none of that name.
	 */
	customHarness?: (name: CustomHarnessName) => AgentHarness | undefined;
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
	 */
	mcpServersFor?: (
		node: Pick<AgentNode, "connections">,
	) => Promise<McpExpansion>;
	/**
	 * A Command node's secrets, by name: the keychain, then the daemon's
	 * environment. Default: `process.env`.
	 */
	secretEnv?: (names: readonly string[]) => Promise<SecretEnv>;
	/** The connections defined on this computer. */
	connectionNames?: () => ReadonlySet<string>;
	/** The CLI tools defined on this computer. */
	cliNames?: () => ReadonlySet<string>;
	/** Where a program is on this computer, or null. Default: `Bun.which`. */
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
	/** Where a session keeps its artifacts. Without it, sessions keep none. */
	artifacts?: Pick<ArtifactStore, "save">;
	/**
	 * The projects' knowledge folders on this computer. Without it, a step
	 * gets none.
	 */
	knowledge?: KnowledgeFolders;
	/**
	 * What a run step's harness session adds to its environment, read as
	 * the session starts: the export to monitoring gives Claude Code its
	 * own telemetry under the step (`@nightshift/telemetry`). `values` are
	 * the secret values in `env` (an API key in its headers): the session's
	 * output has them as `•••`. Without it, or when it gives nothing:
	 * nothing.
	 */
	sessionEnv?: (session: {
		harness: AgentHarnessName;
		runId: string;
		stepId: string;
	}) => { env: Record<string, string>; values: readonly string[] };
	/**
	 * The values of the saved secrets and of the ones the connections
	 * reference, read as a session starts: its output has each as `•••`,
	 * as an exported run has. Without it: only the values the session was
	 * given (its CLI tools' logins, its MCP servers' and `sessionEnv`'s).
	 */
	secretValues?: () => Promise<readonly string[]>;
	/**
	 * Keeps a project's folder in step with its Space (ADR 4): before and
	 * after each step that gets it. Without it, the folder is this
	 * computer's alone.
	 */
	knowledgeSync?: Pick<KnowledgeSync, "startStep">;
	/**
	 * Keyword search over the folders: this Device's own index. With it, an
	 * agent that gets the folder also gets `search_knowledge` and
	 * `read_knowledge`, where its harness takes Night Shift's own tools.
	 */
	knowledgeSearch?: Pick<KnowledgeSearch, "search" | "read" | "refresh">;
};

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

/** Why a command does not start: secrets it names that this computer does not have. */
function missingSecretsMessage(missing: readonly string[]): string {
	const [noun, isNot, it] =
		missing.length === 1
			? ["secret", "it is", "it"]
			: ["secrets", "they are", "them"];
	return `The command needs the ${noun} ${missing.join(", ")}, but ${isNot} not saved. Save ${it} on the Secrets page, or remove ${it} from the node.`;
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

/**
 * Brings the project's folder in step with its Space, when this computer
 * syncs it, and holds it for the step: nothing else reconciles it until
 * `done`, which publishes what the step changed. A reconcile that fails
 * leaves the folder as it is: the step goes on.
 */
async function holdKnowledge(
	deps: LocalDeviceDeps,
	request: KnowledgeRequest | undefined,
): Promise<{ done(): Promise<void> }> {
	if (!request || !deps.knowledge || !deps.knowledgeSync) {
		return { done: async () => {} };
	}
	return deps.knowledgeSync.startStep(request.projectId);
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
	const findCli = deps.findCli ?? ((name: string) => Bun.which(name));
	const mcpServersFor =
		deps.mcpServersFor ??
		(async (node: Pick<AgentNode, "connections">): Promise<McpExpansion> =>
			(node.connections ?? []).length > 0
				? {
						ok: false,
						message: `The node uses connections (${node.connections?.join(", ")}), but there are none. Add them under Agents → Tools.`,
					}
				: { ok: true, servers: {} });
	const secretEnv =
		deps.secretEnv ??
		(async (names: readonly string[]): Promise<SecretEnv> => {
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
	const harnessFor = (name: AgentHarnessName): AgentHarness | undefined => {
		if (isCustomHarness(name)) return deps.customHarness?.(name);
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
			knowledge,
			...rest
		} = input;
		const harness = harnessFor(name);
		if (!harness) {
			yield {
				type: "refused",
				message: `No ${harnessNoun(name)} is added. Add it under Agents.`,
			};
			return;
		}
		// `${NAME}` in env values and headers reads the keychain, then the
		// environment. The values go to the harness only, never into the log.
		const mcp = await mcpServersFor(connections ? { connections } : {});
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
				? await deps.toolLaunchers.prepare(clis)
				: null;
		if (tools && !tools.ok) {
			yield { type: "refused", message: tools.message };
			return;
		}
		let hold: { done(): Promise<void> } | null = null;
		try {
			// A new session learns its CLI tools after the prompt. A resumed
			// session has them already.
			const guide =
				!input.resumeSessionId && withClis && deps.cliToolsFor
					? cliToolsInstruction(await deps.cliToolsFor(clis))
					: "";
			const guarded = deps.toolLaunchers?.guarded() ?? [];
			// The knowledge as the Space has it now, before the agent reads it.
			hold = await holdKnowledge(deps, knowledge);
			const known =
				knowledge && deps.knowledge
					? await sessionKnowledge(deps.knowledge, knowledge).catch((error) => {
							console.warn("The knowledge folder was left out:", error);
							return null;
						})
					: null;
			const added = artifacts
				? deps.sessionEnv?.({ harness: name, ...artifacts })
				: undefined;
			const env = {
				...added?.env,
				...known?.env,
				...tools?.env,
			};
			// An agent that reads the knowledge may search it. The index
			// starts to catch up with the folder now, not at the first search.
			const search =
				known?.addDirs && knowledge && deps.knowledgeSearch
					? sessionKnowledgeTools(deps.knowledgeSearch, knowledge.projectId)
					: null;
			if (search && knowledge) {
				deps.knowledgeSearch?.refresh(knowledge.projectId).catch((error) => {
					console.warn(
						"The knowledge search index was not brought up to date:",
						error,
					);
				});
			}
			// An agent that reads the knowledge may propose to add to it.
			const learn =
				known?.addDirs && knowledge && artifacts && deps.knowledge
					? { projectId: knowledge.projectId, runId: artifacts.runId }
					: null;
			yield { type: "ready", harness: name };
			const run = harness.run({
				...rest,
				...(learn ? { stepReport: withLearnings(rest.stepReport) } : {}),
				prompt: guide ? `${input.prompt}\n\n${guide}` : input.prompt,
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
				...(Object.keys(env).length > 0 ? { env } : {}),
				...(known?.addDirs ? { addDirs: known.addDirs } : {}),
				...(known?.instructions ? { instructions: known.instructions } : {}),
				...(search ?? {}),
				...(guarded.length > 0 ? { scrubEnv: guarded } : {}),
			});
			const events =
				learn && deps.knowledge
					? keepLearnings(run, deps.knowledge, learn)
					: run;
			// Every secret value the session could see comes back as `•••`.
			const hidden = [
				...(tools?.values ?? []),
				...(mcp.values ?? []),
				...(added?.values ?? []),
				...((await deps.secretValues?.().catch((error) => {
					console.warn("The saved secrets were not read:", error);
					return [];
				})) ?? []),
			];
			yield* hidden.length > 0 ? redactSession(events, hidden) : events;
		} finally {
			await tools?.cleanup();
			// What the step changed, and the learnings it proposed, go to the Space.
			await hold?.done();
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
		const { secrets = [], knowledge, ...command } = input;
		// The secrets of the CLI tools' logins go to their launchers only. A
		// command that names one in `secrets` gets it below.
		const scrub = (deps.toolLaunchers?.guarded() ?? []).filter(
			(name) => !secrets.includes(name),
		);
		const found =
			secrets.length > 0
				? await secretEnv(secrets)
				: { ok: true as const, env: {} };
		if (!found.ok) {
			yield { type: "refused", message: missingSecretsMessage(found.missing) };
			return;
		}
		// The knowledge as the Space has it now, before the command reads it.
		const hold = await holdKnowledge(deps, knowledge);
		let tools: Awaited<ReturnType<ToolLaunchers["forCommand"]>> | null = null;
		try {
			// The sync flows write here. A folder that cannot be made is left out.
			const known =
				knowledge && deps.knowledge
					? await commandKnowledge(deps.knowledge, knowledge).catch(() => ({}))
					: {};
			tools = (await deps.toolLaunchers?.forCommand()) ?? null;
			const env: Record<string, string> = {
				...known,
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
			yield* hidden.length > 0 ? redactExec(events, hidden) : events;
		} finally {
			await tools?.cleanup();
			// What the command changed, a sync's files, go to the Space.
			await hold.done();
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
			};
		},
		session,
		exec,
		async callTool(input): Promise<ToolResult> {
			const mcp = await mcpServersFor({ connections: [input.connection] });
			if (!mcp.ok) return { kind: "refused", message: mcp.message };
			const server = mcp.servers[input.connection];
			if (!server) {
				return {
					kind: "refused",
					message: `There is no connection named "${input.connection}". Add it under Agents → Tools, or pick another one.`,
				};
			}
			return callServerTool(server, input);
		},
		decide,
		flows: async (projectId) => deps.flows?.(projectId) ?? {},
		async worktree(run) {
			const repoPath = await cloneOf(run.projectId);
			const readiness = await checkProjectFolder(repoPath, { git });
			const notReady = readiness.steps.find(
				(step) => step.status === "failed" && step.id !== "identity",
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
