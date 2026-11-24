import { describe, expect, test } from "bun:test";
import type { AgentProfile } from "@nightshift/flows";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
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
		const save = saveConnection({
			...ports,
			computerAccess: inMemoryComputer(),
		});
		await save(NIGHT_SHIFT, {
			connection: { name: "github", server },
			previousName: "gh",
		});
		expect(ports.connections.list().map((one) => one.name)).toEqual(["github"]);
		expect(ports.profiles.get(fast.id)).toMatchObject({
			connections: ["github"],
		});
	});

	test("a change that keeps the name is no other connection", async () => {
		const ports = {
			connections: inMemoryConnections(["gh"]),
			profiles: inMemoryProfiles(),
		};
		const save = saveConnection({
			...ports,
			computerAccess: inMemoryComputer(),
		});
		const changed = { name: "gh", server: { ...server, command: "other-mcp" } };
		await save(NIGHT_SHIFT, { connection: changed, previousName: "gh" });
		expect(ports.connections.get("gh")).toMatchObject(changed);
	});

	test("refuses a name another connection has", async () => {
		const ports = {
			connections: inMemoryConnections(["gh"]),
			profiles: inMemoryProfiles(),
		};
		await expect(
			saveConnection({ ...ports, computerAccess: inMemoryComputer() })(
				NIGHT_SHIFT,
				{
					connection: { name: "gh", server },
					previousName: "other",
				},
			),
		).rejects.toThrow(
			'A connection named "gh" already exists. Pick another name.',
		);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = saveConnection({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
