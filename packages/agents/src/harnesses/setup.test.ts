import { describe, expect, test } from "bun:test";
import { harnessNameSchema } from "@nightshift/flows";

import { harnessSetup } from "./facts";

/**
 * The guided setup runs the vendor's script with a shell, so its address
 * is fixed data that a shell cannot read as anything else (ADR 25).
 */
describe("the guided setup of a harness", () => {
	test("Claude Code and Codex have one, the others are installed by the person", () => {
		const withSetup = harnessNameSchema.options.filter(
			(name) => harnessSetup(name) !== null,
		);
		expect(withSetup).toEqual(["claude-code", "codex"]);
	});

	test("each install script is a fixed https address without shell characters", () => {
		for (const name of harnessNameSchema.options) {
			const setup = harnessSetup(name);
			if (!setup) continue;
			expect(setup.installScript).toMatch(
				/^https:\/\/[a-z0-9.-]+\.[a-z]+\/[A-Za-z0-9._/-]+$/,
			);
			expect(new URL(setup.installScript).protocol).toBe("https:");
			expect(["bash", "sh"]).toContain(setup.installShell);
			expect(setup.binDir).not.toStartWith("/");
			for (const value of Object.values(setup.installEnv)) {
				expect(value).toMatch(/^[A-Za-z0-9._-]*$/);
			}
		}
	});

	test("the sign-in hosts are bare host names of the vendor", () => {
		expect(harnessSetup("claude-code")?.signInHosts).toContain("claude.ai");
		expect(harnessSetup("codex")?.signInHosts).toContain("openai.com");
		for (const name of harnessNameSchema.options) {
			for (const host of harnessSetup(name)?.signInHosts ?? []) {
				expect(host).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
			}
		}
	});

	test("Codex installs without a question", () => {
		expect(harnessSetup("codex")?.installEnv).toEqual({
			CODEX_NON_INTERACTIVE: "1",
		});
	});
});
