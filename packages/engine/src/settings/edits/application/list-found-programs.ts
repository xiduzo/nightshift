import type { Actor } from "../../../contract";
import { programOf } from "../../cli-tools";
import { type FoundProgram, foundPrograms } from "../domain/found-programs";
import type {
	EditedCliTools,
	EditedProfiles,
	EditedSettings,
	Programs,
} from "./ports";

export type ListFoundProgramsPorts = {
	settings: Pick<EditedSettings, "bin">;
	profiles: Pick<EditedProfiles, "list">;
	cliTools: Pick<EditedCliTools, "list">;
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
				bin: ports.settings.bin,
				profiles: ports.profiles.list(),
				toolPrograms: ports.cliTools.list().map(programOf),
			},
			ports.programs.where,
		);
