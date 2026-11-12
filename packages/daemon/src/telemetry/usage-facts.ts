import { findProgram } from "@nightshift/agents/types";
import { membersOf, spaceIds } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { HARNESS_BIN } from "@nightshift/engine/device-config";

/** Counts for the daily usage event. No names, paths or free text leave here. */
export async function usageFacts(input: {
	db: Database;
	settings: {
		current(): {
			customAgents: { command: string }[];
			[key: string]: unknown;
		};
	};
	listScreens(personId: string): Promise<{ kind: string }[]>;
	devices: {
		overview(query: { personId: string; owner: boolean }): Promise<{
			thisComputer: { hosts: unknown[] } | null;
		}>;
	};
	ownerId: string;
	/** Where a program is on this computer, or null. Default: `findProgram`. */
	which?: (program: string) => string | null;
}): Promise<{
	agents: number;
	phone: boolean;
	paired: boolean;
	spaces: number;
	members: number;
}> {
	const which = input.which ?? ((program: string) => findProgram(program));
	const current = input.settings.current();
	let agents = 0;
	for (const name of Object.keys(HARNESS_BIN) as (keyof typeof HARNESS_BIN)[]) {
		const bin = current[HARNESS_BIN[name]];
		if (typeof bin === "string" && which(bin)) agents += 1;
	}
	for (const agent of current.customAgents) {
		if (which(agent.command)) agents += 1;
	}
	const screens = await input.listScreens(input.ownerId);
	const overview = await input.devices.overview({
		personId: input.ownerId,
		owner: true,
	});
	const spaces = await spaceIds(input.db);
	const people = new Set<string>();
	for (const spaceId of spaces) {
		const listed = await membersOf(input.db, spaceId);
		for (const member of listed.members) people.add(member.personId);
	}
	return {
		agents,
		phone: screens.some((screen) => screen.kind === "expo"),
		paired: (overview.thisComputer?.hosts.length ?? 0) > 0,
		spaces: spaces.length,
		members: people.size,
	};
}
