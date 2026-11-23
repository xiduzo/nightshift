import type { Actor } from "../../../contract";
import { programOf } from "../../cli-tools";
import {
	foundPrograms,
	programToSetUp,
	type SetUpProgram,
} from "../domain/found-programs";
import { agentProfileOn } from "../domain/profile-edits";
import type {
	EditedCliTools,
	EditedConnections,
	EditedProfiles,
	EditedSettings,
	Programs,
} from "./ports";

export type SetUpProgramPorts = {
	settings: EditedSettings;
	profiles: EditedProfiles;
	cliTools: EditedCliTools;
	connections: Pick<EditedConnections, "get">;
	programs: Programs;
};

/**
 * Sets up one found program. An agent CLI: its harness is added, and an
 * Agent Profile on it, named after the program, with the harness's default
 * model and the night's permission mode. A CLI tool: a tool of its name.
 * Refused for a program that is not found, or is set up already.
 */
export const setUpProgram =
	(ports: SetUpProgramPorts) =>
	async (
		_actor: Actor,
		request: { program: string },
	): Promise<SetUpProgram> => {
		const found = programToSetUp(
			foundPrograms(
				{
					bin: ports.settings.bin,
					profiles: ports.profiles.list(),
					toolPrograms: ports.cliTools.list().map(programOf),
				},
				ports.programs.where,
			),
			request.program,
		);
		if (found.kind === "tool") {
			const tool = await ports.cliTools.save({ name: found.program });
			return { kind: "tool", name: tool.name };
		}
		const profile = await agentProfileOn(ports, found.harness, found.program);
		return { kind: "agent", profileId: profile.id, name: profile.name };
	};
