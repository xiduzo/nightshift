import { describe, expect, test } from "bun:test";
import type { AgentProfile } from "@nightshift/flows";
import { NIGHT_SHIFT } from "../../../contract";
import {
	inMemoryEditedCliTools,
	inMemoryEditedProfiles,
} from "../adapters/out/in-memory-neighbours";
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
			cliTools: inMemoryEditedCliTools(),
			profiles: inMemoryEditedProfiles(),
		};
		await ports.cliTools.save({ name: "jq" });
		const fast = await ports.profiles.save(profile({ clis: ["jq"] }));
		await removeCliTool(ports)(NIGHT_SHIFT, { name: "jq" });
		expect(ports.cliTools.list()).toEqual([]);
		expect(ports.profiles.get(fast.id)).toMatchObject({ clis: [] });
	});
});
