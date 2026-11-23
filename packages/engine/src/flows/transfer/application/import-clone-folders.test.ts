import { describe, expect, spyOn, test } from "bun:test";
import { inMemoryTransferPorts } from "../adapters/out/in-memory-neighbours";
import { importCloneFolders } from "./import-clone-folders";

const clone = (id: string, projectId: string) => ({
	id,
	projectId,
	spaceId: "space",
	repoPath: `/repos/${id}`,
});

describe("importCloneFolders", () => {
	test("imports every Clone of this Device, or the Clone of one project", async () => {
		const ports = inMemoryTransferPorts();
		ports.clones.add("laptop", clone("one", "project"));
		ports.clones.add("laptop", clone("two", "other"));
		ports.clones.add("desktop", clone("three", "project"));
		await importCloneFolders(ports)({});
		expect(ports.documents.opened).toEqual(["project", "other"]);
		await importCloneFolders(ports)({ projectId: "other" });
		expect(ports.documents.opened).toEqual(["project", "other", "other"]);
	});

	test("an import that fails is logged, and the next Clone still comes in", async () => {
		const ports = inMemoryTransferPorts();
		ports.clones.add("laptop", clone("one", "project"));
		ports.clones.add("laptop", clone("two", "other"));
		ports.folders.write("/repos/one", "flows/build.json", "{}");
		ports.saved.fail(new Error("disk full"));
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			await importCloneFolders(ports)({});
			expect(warn).toHaveBeenCalledTimes(1);
			expect(ports.documents.opened).toEqual(["project", "other"]);
		} finally {
			warn.mockRestore();
		}
	});

	test("a list that fails is logged at the start only, and never throws", async () => {
		const ports = inMemoryTransferPorts();
		ports.clones.fail(new Error("no database"));
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			await importCloneFolders(ports)({ projectId: "project" });
			expect(warn).not.toHaveBeenCalled();
			await importCloneFolders(ports)({});
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
	});
});
