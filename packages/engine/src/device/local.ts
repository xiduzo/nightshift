import type {
	AgentHarness,
	Decider,
	DeciderName,
	DecisionInput,
	DecisionResult,
	HarnessName,
	ValueInput,
	ValueResult,
} from "@nightshift/agents";
import { harnessNoun } from "@nightshift/agents";
import {
	type AgentHarnessName,
	type AgentNode,
	type AgentProfileSettings,
	type CustomHarnessName,
	deciderNameSchema,
	isCustomHarness,
} from "@nightshift/flows";
import { readFlowSources } from "@nightshift/flows/files";

import { type CliToolGuide, cliToolsInstruction } from "../cli-tools";
import { spawnCommand } from "../command";
import { expandMcpServers, type McpExpansion } from "../mcp";
import { checkProjectFolder, type GitProbe } from "../project-setup";
import { NOT_ON_THIS_COMPUTER } from "../projects";
import {
	createAndCheckoutBranch,
	createWorktree,
	currentBranch,
	freeBranchName,
	pullRunBranch,
	pushRunBranch,
} from "../worktrees";
import { callServerTool } from "./tool-call";
import type {
	Capabilities,
	DeciderFacts,
	Device,
	OfferedSessionInput,
	SessionEvent,
	SessionInput,
	ToolResult,
} from "./types";

/**
 * Everything on this computer a step body may touch: the harnesses, the
 * decider, the MCP connections with their secrets, the CLI tools, `sh -c`
 * and git worktrees. `services.ts` wires it from the daemon's stores; a
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
	 * An Agent node's MCP servers: its connections and its own servers, with
	 * `${NAME}` expanded. Default: its own servers, from `process.env`.
	 */
	mcpServersFor?: (
		node: Pick<AgentNode, "connections" | "mcpServers">,
	) => Promise<McpExpansion>;
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
	 * The folder of a project's Clone on this computer, or null when it has
	 * none. Without it, this computer has no Clones: a run cannot start here.
	 */
	clonePath?: (projectId: string) => Promise<string | null>;
	/** Finds git on this computer before a worktree is added. Default: `probeGit`. */
	probeGit?: GitProbe;
	/** An Agent Profile defined on this computer, by name, or null. */
	profileFor?: (name: string) => AgentProfileSettings | null;
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

/** This computer as a Device. */
export function localDevice(deps: LocalDeviceDeps): Device {
	const { harnesses, decider } = deps;
	const findCli = deps.findCli ?? ((name: string) => Bun.which(name));
	const mcpServersFor =
		deps.mcpServersFor ??
		(async (
			node: Pick<AgentNode, "connections" | "mcpServers">,
		): Promise<McpExpansion> =>
			(node.connections ?? []).length > 0
				? {
						ok: false,
						message: `The node uses connections (${node.connections?.join(", ")}), but there are none. Add them under Agents → Tools.`,
					}
				: expandMcpServers(node.mcpServers, process.env));

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
		const { harness: name, connections, mcpServers, clis, ...rest } = input;
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
		const mcp = await mcpServersFor({
			...(connections ? { connections } : {}),
			...(mcpServers ? { mcpServers } : {}),
		});
		if (!mcp.ok) {
			yield { type: "refused", message: mcp.message };
			return;
		}
		// A new session learns its CLI tools after the prompt. A resumed
		// session has them already. Plan mode runs no command.
		const guide =
			!input.resumeSessionId &&
			input.permissionMode !== "plan" &&
			clis !== undefined &&
			clis.length > 0 &&
			deps.cliToolsFor
				? cliToolsInstruction(await deps.cliToolsFor(clis))
				: "";
		yield { type: "ready", harness: name };
		yield* harness.run({
			...rest,
			prompt: guide ? `${input.prompt}\n\n${guide}` : input.prompt,
			...(clis && clis.length > 0 ? { clis } : {}),
			...(Object.keys(mcp.servers).length > 0
				? { mcpServers: mcp.servers }
				: {}),
		});
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

	/** The folder of the project's Clone here; throws without one. */
	async function cloneOf(projectId: string): Promise<string> {
		const path = (await deps.clonePath?.(projectId)) ?? null;
		if (path === null) throw new Error(NOT_ON_THIS_COMPUTER);
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
					(query.profiles ?? []).flatMap((name) => {
						const profile = deps.profileFor?.(name) ?? null;
						return profile ? [[name, profile]] : [];
					}),
				),
				decider: deciderFacts,
			};
		},
		session,
		exec: spawnCommand,
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
		flows: async (projectId) => readFlowSources(await cloneOf(projectId)),
		async worktree(run) {
			const repoPath = await cloneOf(run.projectId);
			const readiness = await checkProjectFolder(repoPath, {
				...(deps.probeGit ? { probeGit: deps.probeGit } : {}),
			});
			const notReady = readiness.steps.find(
				(step) => step.status === "failed" && step.id !== "identity",
			);
			if (notReady) {
				throw new Error(
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
		async files({ cwd, glob }) {
			const paths: string[] = [];
			for await (const path of new Bun.Glob(glob).scan({
				cwd,
				onlyFiles: true,
			})) {
				if (path === ".git" || path.startsWith(".git/")) continue;
				paths.push(path);
			}
			return paths.sort();
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
	};
}
