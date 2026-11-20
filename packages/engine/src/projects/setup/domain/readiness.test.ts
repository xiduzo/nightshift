import { describe, expect, test } from "bun:test";
import { checkTools } from "./readiness";

describe("the programs of the knowledge sources", () => {
	const which =
		(...found: string[]) =>
		(name: string) =>
			found.includes(name) ? `/usr/bin/${name}` : null;

	test("a missing one is named with the sources that need it and the command that installs it", () => {
		expect(
			checkTools({ which: which("curl", "brew"), platform: "darwin" }),
		).toEqual({
			step: {
				id: "tools",
				status: "failed",
				problem:
					"jq is not on this computer. Jira and Confluence sources need it.",
				fix: "install-tools",
			},
			install: { kind: "command", command: "brew install jq" },
		});
		expect(
			checkTools({ which: which("apk"), platform: "linux" }),
		).toMatchObject({
			step: {
				problem:
					"curl and jq are not on this computer. Web pages, Jira and Confluence sources need them.",
			},
			install: { kind: "command", command: "sudo apk add curl jq" },
		});
		// No package manager: the download page.
		expect(
			checkTools({ which: which("curl"), platform: "linux" }).install,
		).toEqual({
			kind: "manual",
			url: "https://jqlang.org/download/",
		});
	});

	test("none missing: the step is ok", () => {
		expect(
			checkTools({ which: which("curl", "jq"), platform: "linux" }),
		).toEqual({
			step: { id: "tools", status: "ok", problem: null, fix: null },
			install: null,
		});
	});
});
