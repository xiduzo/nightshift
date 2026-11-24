import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { readFlowRevision } from "./read-flow-revision";

const ada = { personId: "ada", door: "session" } as const;
const quick = (prompt: string) =>
	flowSchema.parse(
		singleAgentFlow({ prompt, model: "sonnet", permissionMode: "acceptEdits" }),
	);

/** Two revisions of `build`: `One`, then `Two`. */
async function twoRevisions() {
	const ports = inMemoryEditingPorts();
	await ports.flows.save("project", "build", quick("One"));
	await ports.flows.save("project", "build", quick("Two"));
	const [first, second] = await ports.flows.revisions("project", "build");
	return { ports, first: first?.id ?? "", second: second?.id ?? "" };
}

const of = { spaceId: "space", projectId: "project", name: "build" };

describe("readFlowRevision", () => {
	test("compares a revision with the flow as it is now, or with another revision", async () => {
		const { ports, first, second } = await twoRevisions();
		const read = readFlowRevision(ports);
		const now = await read(ada, { ...of, revisionId: first });
		expect(now.against).toMatchObject({ revisionId: null });
		expect(now.diff).not.toBeNull();
		const same = await read(ada, { ...of, revisionId: first, against: first });
		expect(same.against.revisionId).toBe(first);
		const other = await read(ada, {
			...of,
			revisionId: second,
			against: first,
		});
		expect(other.revision.current).toBe(true);
	});

	test("a revision the flow does not have is not found, as an against too", async () => {
		const { ports, first } = await twoRevisions();
		const read = readFlowRevision(ports);
		const words =
			"This revision does not exist. Open the flow's revisions again.";
		await expect(read(ada, { ...of, revisionId: "gone" })).rejects.toThrow(
			words,
		);
		await expect(
			read(ada, { ...of, revisionId: first, against: "gone" }),
		).rejects.toThrow(words);
	});

	test("a project of another Space is not found", async () => {
		const { ports, first } = await twoRevisions();
		const read = readFlowRevision(ports)(ada, {
			...of,
			projectId: "elsewhere",
			revisionId: first,
		});
		await expect(read).rejects.toThrow("This project does not exist.");
	});

	test("every Member of the Space may, whatever the role, and nobody else", async () => {
		const ports = inMemoryEditingPorts();
		expect(
			await ports.access.whoMay("space", (actor) =>
				readFlowRevision(ports)(actor, {
					spaceId: "space",
					projectId: "project",
					name: "build",
					revisionId: "r",
				}),
			),
		).toEqual(allowing("owner", "admin", "member", "viewer"));
	});
});
