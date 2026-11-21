import { describe, expect, test } from "bun:test";
import { createKnownSecrets } from "./known-secrets";
import { sourceOf } from "./secret-views";

/** What this computer remembers between uses, and the rules that read it. */

describe("createKnownSecrets", () => {
	test("a reason is logged once until it changes, or until the Personal secrets answer", () => {
		const lines: string[] = [];
		const known = createKnownSecrets((line, error) =>
			lines.push(`${line} ${String(error)}`),
		);
		known.warnOnce("read", new Error("offline"));
		known.warnOnce("read", new Error("offline"));
		known.warnOnce("read", new Error("offline"), "Project");
		known.answered();
		known.warnOnce("read", new Error("offline"), "Project");
		expect(lines).toEqual([
			"[secrets] the Personal secrets were not read: Error: offline",
			"[secrets] the Project secrets were not read: Error: offline",
			"[secrets] the Project secrets were not read: Error: offline",
		]);
	});

	test("the Project names are kept per Project", () => {
		const known = createKnownSecrets(() => {});
		known.projectNamesOf("a").add("TOKEN");
		expect(known.projectNamesOf("a").has("TOKEN")).toBe(true);
		expect(known.projectNamesOf("b").has("TOKEN")).toBe(false);
	});
});

describe("sourceOf", () => {
	test("Personal, then this computer's keychain, then the environment", () => {
		const known = {
			personal: new Map([["P", 1]]),
			saved: new Map<string, number | null>([
				["P", 1],
				["K", null],
			]),
			env: { P: "x", K: "x", E: "x" },
		};
		expect(["P", "K", "E", "M"].map((name) => sourceOf(name, known))).toEqual([
			"personal",
			"keychain",
			"env",
			"missing",
		]);
	});
});
