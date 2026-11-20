import { describe, expect, test } from "bun:test";
import { normaliseRemote } from "./remote";

describe("normaliseRemote", () => {
	test("the ssh, scp-like and https URLs of one repository are one string", () => {
		for (const url of [
			"git@github.com:acme/app.git",
			"git@github.com:acme/app",
			"ssh://git@github.com/acme/app.git",
			"ssh://git@github.com:22/acme/app.git",
			"https://github.com/acme/app.git",
			"https://github.com/acme/app/",
			"https://ada:token@GitHub.com/acme/app.git",
			"http://github.com:80/acme/app",
			"git://github.com/acme/app.git",
		]) {
			expect(normaliseRemote(url)).toBe("github.com/acme/app");
		}
	});

	test("the path keeps its case and its depth", () => {
		expect(normaliseRemote("git@gitlab.com:Acme/Group/App.git")).toBe(
			"gitlab.com/Acme/Group/App",
		);
	});

	test("a path on this computer is no remote", () => {
		for (const url of [
			"/srv/git/app.git",
			"../app",
			"file:///srv/git/app.git",
			"C:\\repos\\app",
			"",
		]) {
			expect(normaliseRemote(url)).toBeNull();
		}
	});
});
