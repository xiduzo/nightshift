import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { restoreFlowRevision } from "./restore-flow-revision";

const ada = { personId: "ada", door: "session" } as const;
const quick = (prompt: string) =>
	flowSchema.parse(
		singleAgentFlow({ prompt, model: "sonnet", permissionMode: "acceptEdits" }),
	);
const of = { spaceId: "space", projectId: "project", name: "build" };

describe("restoreFlowRevision", () => {
	test("saves the revision's flow as a revision of kind restore by the Person", async () => {
		const ports = inMemoryEditingPorts();
		await ports.flows.save("project", "build", quick("One"));
		await ports.flows.save("project", "build", quick("Two"));
		const [first] = await ports.flows.revisions("project", "build");
		await restoreFlowRevision(ports)(ada, {
			...of,
			revisionId: first?.id ?? "",
		});
		expect(ports.flows.saves.at(-1)).toMatchObject({
			kind: "restore",
			personId: "ada",
			flow: { nodes: quick("One").nodes },
		});
	});

	test("refuses a revision that does not exist, and one that is not a valid flow", async () => {
		const ports = inMemoryEditingPorts();
		await ports.flows.save("project", "build", quick("One"));
		const restore = restoreFlowRevision(ports);
		await expect(restore(ada, { ...of, revisionId: "gone" })).rejects.toThrow(
			"This revision does not exist. Open the flow's revisions again.",
		);
		const [first] = await ports.flows.revisions("project", "build");
		ports.flows.revisions = async () => [
			{ ...(first ?? ({} as never)), flow: { version: 1, nodes: "no" } },
		];
		await expect(
			restore(ada, { ...of, revisionId: first?.id ?? "" }),
		).rejects.toThrow(
			"This revision is not a valid flow, so you cannot restore it.",
		);
		expect(ports.flows.saves).toHaveLength(1);
	});

	test("a project of another Space is not found", async () => {
		const ports = inMemoryEditingPorts();
		const restore = restoreFlowRevision(ports)(ada, {
			...of,
			projectId: "elsewhere",
			revisionId: "r",
		});
		await expect(restore).rejects.toThrow("This project does not exist.");
	});
});
