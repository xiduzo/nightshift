import type { DeciderName } from "@nightshift/flows";

import type { OllamaInstall } from "./decider-plan";
import type { DeciderSetupJob } from "./setup-jobs";
import type { AgentSetupBlock } from "./setup-place";

export type DeciderSetupStatus = {
	/** The setup can act here, for this request. */
	available: boolean;
	reason: AgentSetupBlock | null;
	/** Why not, for the person. Null when it is available. */
	message: string | null;
	/** The decider new Decision nodes start on now. `chosen`: the person saved it. */
	current: { decider: DeciderName; chosen: boolean };
	/** Ollama, and the model a local decider downloads. */
	local: {
		model: string;
		/** About how big the download of the model is, in bytes. */
		bytes: number;
		/** Null: Ollama on this computer. Else the host name of the Ollama Night Shift uses. */
		where: string | null;
		/** An `ollama` program is on this computer. */
		installed: boolean;
		answers: boolean;
		hasModel: boolean;
		install: OllamaInstall | null;
	};
	typesafe: {
		/** A TypeSafe key is saved, or set in the environment. */
		keySaved: boolean;
		/** Where the person gets a key. */
		keyPage: string;
	};
	job: DeciderSetupJob;
};
