import type { Actor } from "../../../contract";
import { type CliToolStore, programOf } from "../../cli-tools";
import type { ConnectionStore } from "../../connections";
import type { ProfileStore } from "../../profiles";
import { HARNESS_BIN, type SettingsStore } from "../../settings";
import {
	foundPrograms,
	programToSetUp,
	type SetUpProgram,
} from "../domain/found-programs";
import { agentProfileOn } from "../domain/profile-edits";
import type { Programs } from "./ports";

export type SetUpProgramPorts = {
	settings: Pick<SettingsStore, "current" | "save">;
	profiles: Pick<ProfileStore, "get" | "byName" | "list" | "save">;
	cliTools: Pick<CliToolStore, "get" | "list" | "save">;
	connections: Pick<ConnectionStore, "get">;
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
					bin: (harness) =>
						String(ports.settings.current()[HARNESS_BIN[harness]]),
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
