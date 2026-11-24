import { describe, expect, test } from "bun:test";
import type { AgentProfile } from "@nightshift/flows";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryConnections } from "../../connections/adapters/out/in-memory-connections";
import { inMemoryProfiles } from "../../profiles/adapters/out/in-memory-profiles";
import { saveConnection } from "./save-connection";

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

const server = { command: "gh-mcp", args: [], env: {} };

describe("saveConnection", () => {
	test("a rename moves the profiles that name it, and takes the old name away", async () => {
		const ports = {
			connections: inMemoryConnections(["gh"]),
			profiles: inMemoryProfiles(),
		};
		const fast = await ports.profiles.save(profile({ connections: ["gh"] }));
		const save = saveConnection(ports);
		await save(NIGHT_SHIFT, {
			connection: { name: "github", server },
			previousName: "gh",
		});
		expect(ports.connections.list().map((one) => one.name)).toEqual(["github"]);
		expect(ports.profiles.get(fast.id)).toMatchObject({
			connections: ["github"],
		});
	});

	test("refuses a name another connection has", async () => {
		const ports = {
			connections: inMemoryConnections(["gh"]),
			profiles: inMemoryProfiles(),
		};
		await expect(
			saveConnection(ports)(NIGHT_SHIFT, {
				connection: { name: "gh", server },
				previousName: "other",
			}),
		).rejects.toThrow(
			'A connection named "gh" already exists. Pick another name.',
		);
	});
});
