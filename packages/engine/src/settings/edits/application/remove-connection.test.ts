import { describe, expect, test } from "bun:test";
import type { AgentProfile } from "@nightshift/flows";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryConnections } from "../../connections/adapters/out/in-memory-connections";
import { inMemoryProfiles } from "../../profiles/adapters/out/in-memory-profiles";
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
			connections: inMemoryConnections(["gh", "linear"]),
			profiles: inMemoryProfiles(),
		};
		const fast = await ports.profiles.save(
			profile({ connections: ["gh", "linear"] }),
		);
		await removeConnection(ports)(NIGHT_SHIFT, { name: "gh" });
		expect(ports.connections.list().map((one) => one.name)).toEqual(["linear"]);
		expect(ports.profiles.get(fast.id)).toMatchObject({
			connections: ["linear"],
		});
	});
});
