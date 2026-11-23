import { describe, expect, test } from "bun:test";

import { chooseProject, type TerminalProject } from "./terminal-project";

const app: TerminalProject = { id: "p1", name: "App", path: "/work/app" };
const api: TerminalProject = { id: "p2", name: "API", path: "/work/app/api" };
const remote: TerminalProject = { id: "p3", name: "Docs", path: null };

describe("the project a terminal command works in", () => {
	test("is the one named by id, name or folder", () => {
		const projects = [app, api, remote];
		expect(chooseProject(projects, "p3", null)).toEqual({
			kind: "found",
			project: remote,
		});
		expect(chooseProject(projects, "api", null)).toEqual({
			kind: "found",
			project: api,
		});
		expect(chooseProject(projects, "/work/app/src", null)).toEqual({
			kind: "found",
			project: app,
		});
		expect(chooseProject(projects, "nope", "/work/app")).toEqual({
			kind: "unknown",
			wanted: "nope",
		});
	});

	test("is the one whose Clone holds the folder, the deepest one", () => {
		expect(chooseProject([app, api], null, "/work/app/api/src")).toEqual({
			kind: "found",
			project: api,
		});
	});

	test("is the only project, else none", () => {
		expect(chooseProject([remote], null, "/elsewhere")).toEqual({
			kind: "found",
			project: remote,
		});
		expect(chooseProject([app, remote], null, "/elsewhere")).toEqual({
			kind: "ambiguous",
		});
		expect(chooseProject([], null, null)).toEqual({ kind: "none" });
	});
});
