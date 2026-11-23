import { describe, expect, test } from "bun:test";
import type { AgentProfile } from "@nightshift/flows";
import { NIGHT_SHIFT } from "../../../contract";
import {
	inMemoryEditedConnections,
	inMemoryEditedProfiles,
} from "../adapters/out/in-memory-neighbours";
import { removeConnection } from "./remove-connection";

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

describe("removeConnection", () => {
	test("removes the connection and takes it off the profiles that name it", async () => {
		const ports = {
			connections: inMemoryEditedConnections(["gh", "linear"]),
			profiles: inMemoryEditedProfiles(),
		};
		const fast = await ports.profiles.save(
			profile({ connections: ["gh", "linear"] }),
		);
		await removeConnection(ports)(NIGHT_SHIFT, { name: "gh" });
		expect(ports.connections.names()).toEqual(["linear"]);
		expect(ports.profiles.get(fast.id)).toMatchObject({
			connections: ["linear"],
		});
	});
});
