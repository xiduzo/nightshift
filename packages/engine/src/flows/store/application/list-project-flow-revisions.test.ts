import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { inMemoryStorePorts } from "../adapters/out/in-memory-neighbours";
import { listProjectFlowRevisions } from "./list-project-flow-revisions";

const quick = (prompt: string) =>
	flowSchema.parse(
		singleAgentFlow({ prompt, model: "sonnet", permissionMode: "acceptEdits" }),
	);

describe("listProjectFlowRevisions", () => {
	test("lists the revisions oldest first, and none for a flow that does not exist", async () => {
		const ports = inMemoryStorePorts();
		for (const [prompt, at] of [
			["One", 1],
			["Two", 2],
		] as const) {
			await ports.store.save("project", {
				name: "build",
				flow: quick(prompt),
				kind: "save",
				personId: "ada",
				deviceId: "laptop",
				at,
			});
		}
		const list = listProjectFlowRevisions(ports);
		const revisions = await list({ projectId: "project", name: "build" });
		expect(revisions.map((r) => r.at)).toEqual([1, 2]);
		expect(await list({ projectId: "project", name: "gone" })).toEqual([]);
	});

	test("refuses a Project this Replica does not have", async () => {
		const ports = inMemoryStorePorts();
		const list = listProjectFlowRevisions(ports)({
			projectId: "gone",
			name: "build",
		});
		await expect(list).rejects.toThrow("This project does not exist.");
	});
});
