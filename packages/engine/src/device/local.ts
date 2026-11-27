import { stat } from "node:fs/promises";
import type {
	Decider,
	DeciderName,
	DecisionInput,
	DecisionResult,
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
import { findProgram } from "@nightshift/agents/types";
import { deciderNameSchema, FLOW_VERSION } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

import { NotOnThisComputer } from "../contract";
import { createWorktreeSnapshots, createWorktrees, systemGit } from "../git";
import type { RunFolders } from "../run-folders";
import { localExec } from "./exec";
import {
	type DeviceConnections,
	type LocalDeviceDeps,
	NO_CONNECTIONS,
} from "./local-deps";
import { readFolderFile } from "./read-file";
import { localSession } from "./session";
import { stepSecrets } from "./step-secrets";
import { callServerTool } from "./tool-call";
import {
	type AddressCheck,
	addressKey,
	type Capabilities,
	type DeciderFacts,
	type Device,
	type ToolResult,
} from "./types";
import {
	outgoing,
	requestSecretNames,
	sendRequest,
	type WebRequestResult,
} from "./web-request";

export type {
	DeviceCliTools,
	DeviceConnections,
	LocalDeviceDeps,
} from "./local-deps";
export type { Harnesses } from "./ports";

/** The run's own folder here, as the Device port answers it: no branch, no base. */
function runFolderOf(
	runFolders: Pick<RunFolders, "make">,
): NonNullable<Device["runFolder"]> {
	return async (run) => {
		const { path, made } = await runFolders.make(run.id);
		return { worktreePath: path, branch: "", baseRef: "", made };
	};
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

	const session = localSession(deps, connections);
	const exec = localExec(deps, connections);

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
		if (path === null) throw new NotOnThisComputer();
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
			const secrets = stepSecrets(connections, run);
			const mcp = await secrets.servers([call.connection]);
			if (!mcp.ok) return { kind: "refused", message: mcp.message };
			const server = mcp.servers[call.connection];
			if (!server) {
				return {
					kind: "refused",
					message: `There is no connection named "${call.connection}". Add it under Agents → Tools, or pick another one.`,
				};
			}
			return secrets.hideTool(await callServerTool(server, call));
		},
		/**
		 * A web request from here. Its secrets come from the scopes of its
		 * use, as a command's do: one this computer does not have refuses it
		 * before anything is sent. Their values go to the request only, and
		 * come back masked in the answer and in every message.
		 */
		async request(input): Promise<WebRequestResult> {
			const { run, ...call } = input;
			const secrets = stepSecrets(connections, run);
			const found = await secrets.env(requestSecretNames(call), "The request");
			if (!found.ok) return { kind: "refused", message: found.message };
			const result = await sendRequest(outgoing(call, found.env), {
				privateNetwork: deps.privateNetwork?.() ?? true,
				...(deps.resolve ? { resolve: deps.resolve } : {}),
			});
			return secrets.hideRequest(result);
		},
		// A file is small and local: the signal is not needed here.
		readFile: ({ cwd, path, maxBytes }) =>
			readFolderFile({ cwd, path, maxBytes }),
		decide,
		async worktree(run) {
			const repoPath = await cloneOf(run.projectId);
			const readiness = deps.checkProject
				? await deps.checkProject.check(repoPath)
				: { steps: [] as const };
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
				workGone: (await deps.keptWorkGone?.(run)) ?? null,
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
