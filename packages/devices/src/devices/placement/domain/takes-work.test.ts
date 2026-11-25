import { expect, test } from "bun:test";
import { hasProject, lastResort, projectOn, takesRuns } from "./takes-work";

test("a Device has a project by its Clone, or when the project needs none", () => {
	expect(hasProject({ folder: true }, true)).toBe(true);
	expect(hasProject({ folder: true }, false)).toBe(false);
	expect(hasProject({ folder: false }, false)).toBe(true);
	const clones = [{ deviceId: "a" }];
	expect(["a", "b"].map(projectOn({ folder: true }, clones))).toEqual([
		true,
		false,
	]);
	expect(projectOn({ folder: false }, clones)("b")).toBe(true);
});

const device = (deviceId: string, more: object = {}) => ({
	deviceId,
	online: true,
	hasClone: true,
	...more,
});

test("a run goes only to a Device online, with the project, and no development install", () => {
	expect(takesRuns(device("a"))).toBe(true);
	expect(takesRuns(device("a", { online: false }))).toBe(false);
	expect(takesRuns(device("a", { hasClone: false }))).toBe(false);
	expect(takesRuns(device("a", { dev: true }))).toBe(false);
});

test("as a last resort, the Device of the latest run comes first and the others keep their order", () => {
	const devices = [
		device("a"),
		device("off", { online: false }),
		device("b"),
		device("c"),
	];
	expect(lastResort(devices, "c")).toEqual(["c", "a", "b"]);
	expect(lastResort(devices, null)).toEqual(["a", "b", "c"]);
});
