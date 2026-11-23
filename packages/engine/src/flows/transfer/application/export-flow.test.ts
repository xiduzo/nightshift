import { describe, expect, test } from "bun:test";
import {
	canonicalFlowJson,
	flowSchema,
	singleAgentFlow,
} from "@nightshift/flows";
import { inMemoryTransferPorts } from "../adapters/out/in-memory-neighbours";
import { exportFlow } from "./export-flow";

const ada = { personId: "ada", door: "session" } as const;
const quick = flowSchema.parse(
	singleAgentFlow({
		prompt: "Write",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
);

describe("exportFlow", () => {
	test("gives the flow as a file, in the form Night Shift saves it", async () => {
		const ports = inMemoryTransferPorts();
		await ports.flows.save("project", "build", quick);
		expect(
			await exportFlow(ports)(ada, {
				spaceId: "space",
				projectId: "project",
				name: "build",
			}),
		).toEqual({ fileName: "build.json", json: canonicalFlowJson(quick) });
	});

	test("refuses a flow that is not valid", async () => {
		const ports = inMemoryTransferPorts();
		ports.flows.stored.set("project", { broken: { jsonError: "bad" } });
		const exported = exportFlow(ports)(ada, {
			spaceId: "space",
			projectId: "project",
			name: "broken",
		});
		await expect(exported).rejects.toMatchObject({
			kind: "invalid",
			message: 'The flow "broken" is not valid. Fix it in the editor first.',
		});
	});

	test("a project of another Space is not found", async () => {
		const ports = inMemoryTransferPorts();
		await expect(
			exportFlow(ports)(ada, {
				spaceId: "elsewhere",
				projectId: "project",
				name: "build",
			}),
		).rejects.toMatchObject({ kind: "not-found" });
	});
});
