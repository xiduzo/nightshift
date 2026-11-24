import { describe, expect, test } from "bun:test";
import type { AgentProfile } from "@nightshift/flows";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryCliTools } from "../../cli-tools/adapters/out/in-memory-cli-tools";
import { inMemoryProfiles } from "../../profiles/adapters/out/in-memory-profiles";
import { removeCliTool } from "./remove-cli-tool";

function profile(over: Partial<AgentProfile> = {}): AgentProfile {
	return {
		name: "fast",
		harness: "claude-code",
		model: "sonnet",
		permissionMode: "acceptEdits",
		clis: [],
		connections: [],
		...over,
	} as AgentProfile;
}

describe("removeCliTool", () => {
	test("removes the tool and takes it off the profiles that name it", async () => {
		const ports = {
			cliTools: inMemoryCliTools(),
			profiles: inMemoryProfiles(),
		};
		await ports.cliTools.save({ name: "jq" });
		const fast = await ports.profiles.save(profile({ clis: ["jq"] }));
		await removeCliTool({ ...ports, computerAccess: inMemoryComputer() })(
			NIGHT_SHIFT,
			{ name: "jq" },
		);
		expect(ports.cliTools.list()).toEqual([]);
		expect(ports.profiles.get(fast.id)).toMatchObject({ clis: [] });
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = removeCliTool({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
