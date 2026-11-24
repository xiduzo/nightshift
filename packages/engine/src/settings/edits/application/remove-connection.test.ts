import { describe, expect, test } from "bun:test";
import type { AgentProfile } from "@nightshift/flows";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
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
		await removeConnection({ ...ports, computerAccess: inMemoryComputer() })(
			NIGHT_SHIFT,
			{ name: "gh" },
		);
		expect(ports.connections.list().map((one) => one.name)).toEqual(["linear"]);
		expect(ports.profiles.get(fast.id)).toMatchObject({
			connections: ["linear"],
		});
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = removeConnection({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
