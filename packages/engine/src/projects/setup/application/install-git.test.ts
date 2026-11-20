import { describe, expect, test } from "bun:test";
import { inMemorySetupPorts } from "../adapters/out/in-memory-neighbours";
import { installGit } from "./install-git";

/** The use case installGit, on in-memory adapters. */

describe("installGit", () => {
	test("starts the installer of this computer once, and says how it went", async () => {
		const ports = inMemorySetupPorts();
		expect(await installGit(ports)()).toEqual({ kind: "started" });
		expect(ports.installer.asked).toBe(1);
	});
});
