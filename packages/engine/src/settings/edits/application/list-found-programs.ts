import type { Actor } from "../../../contract";
import { type CliToolStore, programOf } from "../../cli-tools";
import type { ProfileStore } from "../../profiles";
import { HARNESS_BIN, type SettingsStore } from "../../settings";
import { type FoundProgram, foundPrograms } from "../domain/found-programs";
import type { Programs } from "./ports";

export type ListFoundProgramsPorts = {
	settings: Pick<SettingsStore, "current">;
	profiles: Pick<ProfileStore, "list">;
	cliTools: Pick<CliToolStore, "list">;
	programs: Programs;
};

/**
 * The programs Night Shift knows how to use, found on this computer and
 * not set up yet: agents first. Only reads.
 */
export const listFoundPrograms =
	(ports: ListFoundProgramsPorts) =>
	(_actor: Actor): FoundProgram[] =>
		foundPrograms(
			{
				bin: (harness) =>
					String(ports.settings.current()[HARNESS_BIN[harness]]),
				profiles: ports.profiles.list(),
				toolPrograms: ports.cliTools.list().map(programOf),
			},
			ports.programs.where,
		);
