import type { HarnessName } from "@nightshift/flows";
import type { CliTool, CliToolInput } from "../../cli-tools";
import type { Connection, ConnectionInput } from "../../connections";
import type { HarnessBook, ProfileBook } from "../domain/profile-edits";

/**
 * The settings an edit reads and saves: the harnesses, the custom agents,
 * the night's permission mode, and the program each harness runs.
 * @filledBy engine/device-config
 */
export type EditedSettings = HarnessBook & {
	/** The program a harness's setting names (`claudeBin`). */
	bin(harness: HarnessName): string;
};

/**
 * The profiles an edit reads and saves.
 * @filledBy engine/device-config
 */
export type EditedProfiles = ProfileBook;

/**
 * The connections an edit reads, saves and removes.
 * @filledBy engine/device-config
 */
export type EditedConnections = {
	get(name: string): Connection | null;
	save(input: ConnectionInput): Promise<Connection>;
	remove(name: string): Promise<void>;
};

/**
 * The CLI tools an edit reads, saves and removes.
 * @filledBy engine/device-config
 */
export type EditedCliTools = {
	get(name: string): CliTool | null;
	list(): CliTool[];
	save(input: CliToolInput): Promise<CliTool>;
	remove(name: string): Promise<void>;
};

/**
 * Where a program is on this computer: the search of the PATH.
 * @filledBy agents
 */
export type Programs = {
	/** The path of the program, or null when this computer does not have it. */
	where(program: string): string | null;
};
