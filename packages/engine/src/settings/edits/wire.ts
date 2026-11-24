import type { HarnessName } from "@nightshift/flows";
import type { ComputerAccess } from "../../access";
import type { CliToolStore } from "../cli-tools";
import type { ConnectionStore } from "../connections";
import type { ProfileStore } from "../profiles";
import type { SettingsStore } from "../settings";
import { addHarness } from "./application/add-harness";
import { listFoundPrograms } from "./application/list-found-programs";
import type { Programs } from "./application/ports";
import { removeCliTool } from "./application/remove-cli-tool";
import { removeConnection } from "./application/remove-connection";
import { removeHarness } from "./application/remove-harness";
import { saveConnection } from "./application/save-connection";
import { saveCustomAgent } from "./application/save-custom-agent";
import { saveProfile } from "./application/save-profile";
import { setUpProgram } from "./application/set-up-program";

/** The edits of a person that touch more than one part of this computer's configuration. */
export type Edits = {
	saveProfile: ReturnType<typeof saveProfile>;
	saveConnection: ReturnType<typeof saveConnection>;
	removeConnection: ReturnType<typeof removeConnection>;
	removeCliTool: ReturnType<typeof removeCliTool>;
	addHarness: ReturnType<typeof addHarness>;
	removeHarness: ReturnType<typeof removeHarness>;
	saveCustomAgent: ReturnType<typeof saveCustomAgent>;
	listFoundPrograms: ReturnType<typeof listFoundPrograms>;
	setUpProgram: ReturnType<typeof setUpProgram>;
};

/**
 * Binds the edits to the other parts of this computer's configuration:
 * the settings, the profiles, the connections and the CLI tools, as the
 * root of device-config gives them.
 */
export function wireEdits(deps: {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	settings: Pick<SettingsStore, "current" | "save">;
	profiles: Pick<ProfileStore, "get" | "byName" | "list" | "save">;
	connections: Pick<ConnectionStore, "get" | "save" | "remove">;
	cliTools: Pick<CliToolStore, "get" | "list" | "save" | "remove">;
	programs: Programs;
	/** What a person calls each built-in harness. */
	labels: Readonly<Record<HarnessName, string>>;
}): Edits {
	return {
		saveProfile: saveProfile(deps),
		saveConnection: saveConnection(deps),
		removeConnection: removeConnection(deps),
		removeCliTool: removeCliTool(deps),
		addHarness: addHarness(deps),
		removeHarness: removeHarness(deps),
		saveCustomAgent: saveCustomAgent(deps),
		listFoundPrograms: listFoundPrograms(deps),
		setUpProgram: setUpProgram(deps),
	};
}
