import { describe, expect, test } from "bun:test";
import type { AgentProfile } from "@nightshift/flows";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryCliTools } from "../../cli-tools/adapters/out/in-memory-cli-tools";
import { inMemoryConnections } from "../../connections/adapters/out/in-memory-connections";
import { inMemoryProfiles } from "../../profiles/adapters/out/in-memory-profiles";
import { saveProfile } from "./save-profile";

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

function wired() {
	const ports = {
		connections: inMemoryConnections(["gh"]),
		cliTools: inMemoryCliTools(),
		profiles: inMemoryProfiles(),
	};
	return {
		ports,
		save: saveProfile({ ...ports, computerAccess: inMemoryComputer() }),
	};
}

describe("saveProfile", () => {
	test("refuses a connection or a CLI tool that does not exist, and saves nothing", async () => {
		const { ports, save } = wired();
		await expect(
			save(NIGHT_SHIFT, { profile: profile({ connections: ["linear"] }) }),
		).rejects.toThrow(
			'There is no connection named "linear". Add it under Agents → Tools first.',
		);
		await expect(
			save(NIGHT_SHIFT, { profile: profile({ clis: ["jq"] }) }),
		).rejects.toThrow(
			'There is no CLI tool named "jq". Add it under Agents → Tools first.',
		);
		expect(ports.profiles.list()).toEqual([]);
	});

	test("refuses a taken name and a removed profile", async () => {
		const { save } = wired();
		const fast = await save(NIGHT_SHIFT, { profile: profile() });
		await save(NIGHT_SHIFT, { profile: profile({ name: "slow" }) });
		await expect(save(NIGHT_SHIFT, { profile: profile() })).rejects.toThrow(
			'A profile named "fast" already exists. Pick another name.',
		);
		await expect(
			save(NIGHT_SHIFT, { profile: profile({ name: "slow" }), id: fast.id }),
		).rejects.toThrow(
			'A profile named "slow" already exists. Pick another name.',
		);
		await expect(
			save(NIGHT_SHIFT, { profile: profile(), id: "p-gone" }),
		).rejects.toThrow("This profile was removed. Add it again.");
	});

	test("a rename keeps the id", async () => {
		const { ports, save } = wired();
		const fast = await save(NIGHT_SHIFT, {
			profile: profile({ connections: ["gh"] }),
		});
		const quick = await save(NIGHT_SHIFT, {
			profile: profile({ name: "quick" }),
			id: fast.id,
		});
		expect(quick.id).toBe(fast.id);
		expect(ports.profiles.list().map((p) => p.name)).toEqual(["quick"]);
	});

	test("a model profile keeps its address, and a vendor API refuses one", async () => {
		const { ports, save } = wired();
		const address = { baseUrl: "http://gpu-box:11434", apiKey: "PROXY_KEY" };
		const saved = await save(NIGHT_SHIFT, {
			profile: { name: "remote", decider: "ollama", address },
		});
		expect(ports.profiles.get(saved.id)).toMatchObject({ address });
		await expect(
			save(NIGHT_SHIFT, {
				profile: { name: "jev", decider: "typesafe", address },
			}),
		).rejects.toThrow(
			'The decider "typesafe" always uses its own service, so it takes no address. Remove the address, or choose another decider.',
		);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = saveProfile({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
