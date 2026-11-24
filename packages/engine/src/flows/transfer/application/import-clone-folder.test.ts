import { describe, expect, test } from "bun:test";
import {
	canonicalFlowJson,
	flowSchema,
	singleAgentFlow,
} from "@nightshift/flows";
import { inMemoryTransferPorts } from "../adapters/out/in-memory-neighbours";
import { importMarker } from "../domain/clone-import";
import { importCloneFolder } from "./import-clone-folder";

const clone = {
	id: "clone",
	projectId: "project",
	spaceId: "space",
	repoPath: "/repos/one",
};
const quick = flowSchema.parse(
	singleAgentFlow({
		prompt: "Write",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
);

describe("importCloneFolder", () => {
	test("a Clone with no folder is marked done, and nothing else changes", async () => {
		const ports = inMemoryTransferPorts();
		expect(await importCloneFolder(ports)({ clone })).toEqual({
			status: "no-folder",
		});
		const document = ports.documents.document("project");
		expect(document.writes).toEqual([`mark ${importMarker("clone")}`]);
		expect(ports.saved.flushes).toBe(0);
	});

	test("a Clone done before is not read again", async () => {
		const ports = inMemoryTransferPorts();
		ports.folders.write("/repos/one", "flows/build.json", "{}");
		await ports.documents.document("project").mark(importMarker("clone"), 1);
		expect(await importCloneFolder(ports)({ clone })).toEqual({
			status: "already",
		});
		expect(ports.folders.files("/repos/one")).not.toBeNull();
	});

	test("saves the flows, marks the Clone in one change, flushes, then removes the folder", async () => {
		const ports = inMemoryTransferPorts();
		ports.folders.write(
			"/repos/one",
			"flows/build.json",
			canonicalFlowJson(quick),
		);
		expect(await importCloneFolder(ports)({ clone })).toEqual({
			status: "imported",
			flows: ["build"],
			renamed: {},
			profiles: [],
			deleted: true,
		});
		const document = ports.documents.document("project");
		expect(document.writes).toEqual([
			"flow build",
			`mark ${importMarker("clone")}`,
		]);
		expect(document.stored.build).toEqual({ json: quick, revision: "import" });
		expect(ports.saved.flushes).toBe(1);
		expect(ports.folders.files("/repos/one")).toBeNull();
		expect(ports.migrations.asked).toEqual([
			{ deviceId: "laptop", spaceId: "space" },
		]);
	});

	test("keeps a folder git tracks, with a notice that says why", async () => {
		const ports = inMemoryTransferPorts();
		ports.folders.write(
			"/repos/one",
			"flows/build.json",
			canonicalFlowJson(quick),
		);
		ports.folders.track("/repos/one", ["flows/build.json"]);
		const result = await importCloneFolder(ports)({ clone });
		expect(result).toMatchObject({ status: "imported", deleted: false });
		const document = ports.documents.document("project");
		expect(document.notices.map((notice) => notice.kind)).toEqual([
			"folder-kept",
		]);
		expect(ports.folders.files("/repos/one")).not.toBeNull();
	});

	test("keeps a folder git tracks part of, and the notice says so", async () => {
		const ports = inMemoryTransferPorts();
		for (const name of ["build", "night"]) {
			ports.folders.write(
				"/repos/one",
				`flows/${name}.json`,
				canonicalFlowJson(quick),
			);
		}
		ports.folders.track("/repos/one", ["flows/build.json"]);
		const result = await importCloneFolder(ports)({ clone });
		expect(result).toMatchObject({ status: "imported", deleted: false });
		expect(
			ports.documents.document("project").notices.map((n) => n.message),
		).toEqual([expect.stringContaining("Git tracks part of that folder")]);
		expect(ports.folders.files("/repos/one")).not.toBeNull();
	});

	test("does not remove the folder when the documents do not flush", async () => {
		const ports = inMemoryTransferPorts();
		ports.folders.write(
			"/repos/one",
			"flows/build.json",
			canonicalFlowJson(quick),
		);
		ports.saved.fail(new Error("disk full"));
		await expect(importCloneFolder(ports)({ clone })).rejects.toThrow(
			"disk full",
		);
		expect(ports.folders.files("/repos/one")).not.toBeNull();
	});
});
