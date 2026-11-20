import { describe, expect, test } from "bun:test";
import { inMemorySetupPorts } from "../adapters/out/in-memory-neighbours";
import type { ProjectReadiness } from "../domain/readiness";
import { checkProjectFolder } from "./check-project-folder";

/** The use case checkProjectFolder, on in-memory adapters. */

/** The steps a run needs: the tools step has tests of its own. */
const statuses = (readiness: ProjectReadiness) =>
	readiness.steps
		.filter((step) => step.id !== "tools")
		.map((step) => `${step.id}:${step.status}:${step.fix}`);

describe("checkProjectFolder", () => {
	test("git missing stops at the first step and offers the installer", async () => {
		const ports = inMemorySetupPorts();
		ports.folders.state.gitInstalled = false;
		const readiness = await checkProjectFolder(ports)({ path: "/app" });
		expect(statuses(readiness)).toEqual([
			"git:failed:install-git",
			"folder:skipped:null",
			"commit:skipped:null",
		]);
		expect(readiness.ready).toBe(false);
	});

	test("a folder that does not exist has no fix", async () => {
		const ports = inMemorySetupPorts();
		const readiness = await checkProjectFolder(ports)({ path: "/gone" });
		expect(statuses(readiness)).toEqual([
			"git:ok:null",
			"folder:failed:null",
			"commit:skipped:null",
		]);
	});

	test("a plain folder needs set-up, and a name and email without one", async () => {
		const ports = inMemorySetupPorts();
		ports.folders.folder("/app");
		const readiness = await checkProjectFolder(ports)({ path: "/app" });
		expect(statuses(readiness)).toEqual([
			"git:ok:null",
			"folder:failed:set-up-git",
			"commit:failed:set-up-git",
			"identity:failed:set-up-git",
		]);
		expect(readiness.needsIdentity).toBe(true);
	});

	test("a subfolder offers the top folder", async () => {
		const ports = inMemorySetupPorts();
		ports.folders.repository("/app", 1);
		ports.folders.subfolder("/app/docs", "/app");
		const readiness = await checkProjectFolder(ports)({ path: "/app/docs" });
		expect(readiness.topLevel).toBe("/app");
		expect(statuses(readiness)[1]).toBe("folder:failed:use-top-folder");
	});

	test("a repository with a commit is ready, with no identity step, and the tools come last", async () => {
		const ports = inMemorySetupPorts();
		ports.folders.repository("/app", 1);
		const readiness = await checkProjectFolder(ports)({ path: "/app" });
		expect(readiness.ready).toBe(true);
		expect(statuses(readiness)).toEqual([
			"git:ok:null",
			"folder:ok:null",
			"commit:ok:null",
		]);
		expect(readiness.steps.at(-1)?.id).toBe("tools");
	});
});
