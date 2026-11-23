import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow, starterList } from "@nightshift/flows";
import { inMemoryTransferPorts } from "../adapters/out/in-memory-neighbours";
import { importStarters } from "./import-starters";

const ada = { personId: "ada", door: "session" } as const;
const names = starterList().map((starter) => starter.name);

describe("importStarters", () => {
	test("saves every starter as an import by the Person, and notes each", async () => {
		const ports = inMemoryTransferPorts();
		expect(
			await importStarters(ports)(ada, {
				spaceId: "space",
				projectId: "project",
			}),
		).toEqual({ imported: names, skipped: [] });
		expect(ports.flows.saves.map((saved) => saved.name)).toEqual(names);
		expect(
			ports.flows.saves.every(
				(saved) => saved.kind === "import" && saved.personId === "ada",
			),
		).toBe(true);
		expect(ports.usage.notes).toEqual(
			names.map((starter) => ({
				kind: "flow-created",
				from: "starter",
				starter,
			})),
		);
	});

	test("skips a starter whose name the project has already", async () => {
		const ports = inMemoryTransferPorts();
		const [first = "", ...rest] = names;
		const mine = flowSchema.parse(
			singleAgentFlow({
				prompt: "Mine",
				model: "sonnet",
				permissionMode: "acceptEdits",
			}),
		);
		await ports.flows.save("project", first, mine);
		expect(
			await importStarters(ports)(ada, {
				spaceId: "space",
				projectId: "project",
			}),
		).toEqual({ imported: rest, skipped: [first] });
		expect(ports.flows.stored.get("project")?.[first]).toEqual({
			json: mine,
			revision: "save",
		});
	});

	test("a project of another Space is not found", async () => {
		const ports = inMemoryTransferPorts();
		await expect(
			importStarters(ports)(ada, {
				spaceId: "elsewhere",
				projectId: "project",
			}),
		).rejects.toMatchObject({ kind: "not-found" });
		expect(ports.flows.saves).toEqual([]);
	});
});
