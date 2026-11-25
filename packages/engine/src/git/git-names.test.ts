import { describe, expect, test } from "bun:test";
import { branchName, objectId, revision } from "./git-names";

const ID = "a".repeat(40);

describe("objectId", () => {
	test("is a full id as git prints it", () => {
		expect(objectId(ID)).toBe(ID);
		expect(objectId("0".repeat(64))).toBe("0".repeat(64));
	});
	test("is nothing else", () => {
		const others = [
			"",
			"HEAD",
			"abc123",
			`${ID}a`,
			"A".repeat(40),
			`-${ID}`,
			`${ID}\n`,
			`${ID}^`,
			[ID],
			undefined,
		];
		for (const other of others) {
			expect(() => objectId(other)).toThrow("not the id of a git object");
		}
	});
});

describe("branchName", () => {
	test("is a name git gives a branch", () => {
		for (const name of [
			"main",
			"nightshift/abcdef12",
			"nightshift/abcdef12-7-a-trace",
			"feat/ünï_code+x",
			"a-",
			"v1.2",
			"x@y",
			"#12",
		]) {
			expect(branchName(name)).toBe(name);
		}
	});
	test("is nothing else", () => {
		for (const other of [
			"",
			"-f",
			"--track",
			"a:b",
			"*",
			"a b",
			"a\tb",
			"a\u007f",
			"a~1",
			"a^",
			"a?",
			"a[",
			"a\\b",
			"a..b",
			"a@{1}",
			"@",
			"HEAD",
			"/a",
			"a/",
			"a//b",
			".a",
			"a/.b",
			"a.",
			"a.lock",
			"a.lock/b",
			["main"],
			null,
		]) {
			expect(() => branchName(other)).toThrow("not the name of a branch");
		}
	});
});

describe("revision", () => {
	test("is a branch, a tag or a commit", () => {
		for (const ref of ["main", "origin/main", "HEAD~1", "v1^{commit}", ID]) {
			expect(revision(ref)).toBe(ref);
		}
	});
	test("is nothing else", () => {
		for (const other of ["", "-f", "--track", "a\0b", ["main"], undefined]) {
			expect(() => revision(other)).toThrow("not a branch or a commit");
		}
	});
});
