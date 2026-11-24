import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySetupPorts } from "../adapters/out/in-memory-neighbours";
import { installGit } from "./install-git";

/** The use case installGit, on in-memory adapters. */

describe("installGit", () => {
	test("starts the installer of this computer once, and says how it went", async () => {
		const ports = inMemorySetupPorts();
		expect(
			await installGit({ ...ports, computerAccess: inMemoryComputer() })(
				NIGHT_SHIFT,
			),
		).toEqual({ kind: "started" });
		expect(ports.installer.asked).toBe(1);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = installGit({ computerAccess } as never);
	expect(await computerAccess.whoMay((actor) => act(actor))).toEqual(
		ONLY_THE_OWNER,
	);
});
