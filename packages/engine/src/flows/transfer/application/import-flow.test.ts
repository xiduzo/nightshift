import { describe, expect, test } from "bun:test";
import {
	canonicalFlowJson,
	FLOW_VERSION,
	flowSchema,
	singleAgentFlow,
} from "@nightshift/flows";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryTransferPorts } from "../adapters/out/in-memory-neighbours";
import { importFlow } from "./import-flow";

const ada = { personId: "ada", door: "session" } as const;
const quick = flowSchema.parse(
	singleAgentFlow({
		prompt: "Write",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
);
const request = {
	spaceId: "space",
	projectId: "project",
	name: "build",
	json: canonicalFlowJson(quick),
};

describe("importFlow", () => {
	test("saves the file's flow as an import by the Person, and notes it", async () => {
		const ports = inMemoryTransferPorts();
		expect(await importFlow(ports)(ada, request)).toEqual({
			name: "build",
			issues: [],
		});
		expect(ports.flows.saves).toEqual([
			{
				projectId: "project",
				name: "build",
				flow: quick,
				kind: "import",
				personId: "ada",
			},
		]);
		expect(ports.usage.notes).toEqual([
			{ kind: "flow-created", from: "import" },
		]);
	});

	test("a name the project has already gets a suffix", async () => {
		const ports = inMemoryTransferPorts();
		await ports.flows.save("project", "build", quick);
		expect((await importFlow(ports)(ada, request)).name).toBe("build-2");
	});

	test("asks the migration of the Space for the Person who imports", async () => {
		const ports = inMemoryTransferPorts();
		await importFlow(ports)(ada, request);
		await importFlow(ports)(NIGHT_SHIFT, request);
		expect(ports.importMigrations.asked).toEqual([
			{ spaceId: "space", personId: "ada" },
			{ spaceId: "space", personId: null },
		]);
	});

	test("refuses a file that is not a flow, and saves nothing", async () => {
		const ports = inMemoryTransferPorts();
		await expect(
			importFlow(ports)(ada, { ...request, json: "{" }),
		).rejects.toMatchObject({
			kind: "invalid",
			message:
				"This file is not a flow. Choose a flow file that Night Shift exported.",
		});
		expect(ports.flows.saves).toEqual([]);
	});

	test("refuses a flow from a newer Night Shift, and saves nothing", async () => {
		const ports = inMemoryTransferPorts();
		const json = JSON.stringify({
			...JSON.parse(request.json),
			version: FLOW_VERSION + 1,
		});
		const refused = await importFlow(ports)(ada, { ...request, json }).catch(
			(error: unknown) => error as Error,
		);
		expect(refused).toMatchObject({ kind: "invalid" });
		expect((refused as Error).message).toContain(
			"newer version of Night Shift",
		);
		expect(ports.flows.saves).toEqual([]);
	});

	test("a project of another Space is not found", async () => {
		const ports = inMemoryTransferPorts();
		await expect(
			importFlow(ports)(ada, { ...request, spaceId: "elsewhere" }),
		).rejects.toMatchObject({ kind: "not-found" });
		expect(ports.flows.saves).toEqual([]);
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = inMemoryTransferPorts();
		expect(
			await ports.access.whoMay(
				"space",
				(actor) => importFlow(ports)(actor, request),
				() => ports.flows.saves,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
