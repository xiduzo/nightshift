import { tanstackDecider } from "@nightshift/agents";
import {
	createArtifactStore,
	type createOllama,
	createRunFolders,
	localDevice,
} from "@nightshift/engine";
import { wireSetup } from "@nightshift/engine/projects";
import {
	type ConfigStores,
	reachesPrivateNetwork,
} from "@nightshift/engine/settings";
import {
	type BuiltinAnswer,
	builtinModel,
	type ModelPick,
} from "@nightshift/flows";
import type { Telemetry } from "@nightshift/telemetry";
import { localHarnesses } from "./agents";

type LocalDeviceDeps = Parameters<typeof localDevice>[0];
type Ollama = Awaited<ReturnType<typeof createOllama>>;

/**
 * The local block of the daemon's composition (`daemon.ts`): this computer
 * as a Device, with its harnesses and its decider. Every computer-touching
 * piece of a step is here.
 */
export function wireLocalDevice(
	deps: Pick<
		LocalDeviceDeps,
		"id" | "name" | "toolLaunchers" | "clonePath" | "knowledge"
	> & {
		/** Whose kept work the cleanup freed (`Engine.keptWorkGone`). */
		keptWorkGone: NonNullable<LocalDeviceDeps["keptWorkGone"]>;
		config: ConfigStores;
		/** Who may ask of this computer: its owner. */
		computerAccess: Parameters<typeof wireSetup>[0]["computerAccess"];
		dataDir: string;
		/** How the pi harness starts pi-acp. */
		piAcp: string[] | undefined;
		telemetry: Pick<Telemetry, "sessionEnv">;
		/** The Ollama of the knowledge block. */
		ollama: Pick<Ollama, "endpoint">;
	},
) {
	const { settings, connections, cliTools, profiles } = deps.config;
	const { ollama, dataDir } = deps;
	const harnesses = localHarnesses({
		settings,
		connections,
		piAcp: deps.piAcp,
	});
	// Decision nodes decided by a model: TanStack AI deciders, with API
	// keys from the secrets: the run's Project first, when a step asks.
	const decider = tanstackDecider({
		secret: (name, run) => connections.secret(name, run ? { run } : undefined),
		// The same Ollama search by meaning uses, with its headers.
		ollama: () => {
			const at = ollama.endpoint();
			return { host: at.address, headers: at.headers };
		},
	});
	/** This computer as a Device: every computer-touching piece of a step. */
	const local = localDevice({
		id: deps.id,
		name: deps.name,
		harnesses,
		decider,
		// The models the person chose in Settings for Night Shift's own
		// Decider and Brief writer. One that is gone counts as not chosen.
		builtinModels: () => {
			const chosen = settings.current().builtinAgents;
			const pick = (
				answer: BuiltinAnswer | undefined,
				values: boolean,
			): ModelPick | undefined => {
				if (answer?.kind !== "model") return undefined;
				const model = builtinModel(answer, profiles.list(), { values });
				return "problem" in model ? undefined : model;
			};
			const own = pick(chosen.decider, false);
			const briefWriter = pick(chosen["brief-writer"], true);
			return {
				...(own ? { decider: own } : {}),
				...(briefWriter ? { briefWriter } : {}),
			};
		},
		// This computer's configuration, as the stores of its Device document.
		connections,
		cliTools,
		profiles,
		// Project readiness before a worktree: projects capability, as a port.
		checkProject: wireSetup({ computerAccess: deps.computerAccess }),
		toolLaunchers: deps.toolLaunchers,
		clonePath: deps.clonePath,
		// A run whose kept work the cleanup freed is not made again from nothing.
		keptWorkGone: deps.keptWorkGone,
		// A run of a project without a folder works in a folder of its own
		// here, next to the run history (ADR 22).
		runFolders: createRunFolders(dataDir),
		// The files agents keep for the person, next to the run history.
		artifacts: createArtifactStore(dataDir),
		// The projects' knowledge, outside every repository, in step with the Space.
		knowledge: deps.knowledge,
		// What each step changed in the run's copy of the project, also by commands.
		snapshots: true,
		// A Claude Code session sends its own telemetry while the export is on.
		sessionEnv: (session) => deps.telemetry.sessionEnv(session),
		// A session's output has every saved secret's value as •••, the
		// Personal ones too, and those of Ollama's headers.
		secretValues: async (use) => [
			...(await connections.secretValues(use)),
			...ollama.endpoint().secretValues,
		],
		// A Host reaches this computer and its network only when its
		// Settings allow it: it serves every Member of its Spaces.
		privateNetwork: () => reachesPrivateNetwork(settings.current()),
	});
	return { harnesses, decider, local };
}
