import { harnessNoun } from "@nightshift/agents/harness-facts";
import type {
	AgentSessionInput,
	SessionContribution,
} from "@nightshift/agents/types";
import { foldContributions } from "@nightshift/agents/types";

import type { ArtifactStore } from "../artifacts";
import type { DeviceConnections, LocalDeviceDeps } from "./local-deps";
import { PAGE_READER_NAMES } from "./scrubbed";
import { stepSecrets } from "./step-secrets";
import type {
	OfferedSessionInput,
	SessionEvent,
	SessionInput,
	StepKnowledge,
} from "./types";
import { cliToolsInstruction } from "./words";

/** What an agent learns about the files a person added to the run's answers. */
function answerFilesInstruction(paths: readonly string[]): string {
	return [
		"The person added files to their answers in this run. Read the ones your task needs:",
		...paths.map((path) => `- ${path}`),
	].join("\n");
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

/** One harness session on this computer. */
export function localSession(
	deps: LocalDeviceDeps,
	connections: DeviceConnections,
) {
	const { cliTools, harnesses } = deps;
	return session;

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
		const secrets = stepSecrets(connections, run, underOffer);
		const { use } = secrets;
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
		const mcp = await secrets.servers(input.connections);
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
		let known: Awaited<ReturnType<StepKnowledge["forSession"]>> | null = null;
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
				scrubEnv: [...guarded, ...PAGE_READER_NAMES],
			});
			const events = known ? known.events(run) : run;
			// Every secret value the session could see comes back as `•••`.
			secrets.add(tools?.values);
			secrets.add(added?.values);
			secrets.add(
				await harness.secretValues?.().catch((error) => {
					console.warn("The agent's secrets were not read:", error);
					return [];
				}),
			);
			secrets.add(
				await deps.secretValues?.(use).catch((error) => {
					console.warn("The saved secrets were not read:", error);
					return [];
				}),
			);
			yield* secrets.hideSession(events);
		} finally {
			await tools?.cleanup();
			// What the step changed, and the learnings it proposed, go to the Space.
			await known?.done();
		}
	}
}
