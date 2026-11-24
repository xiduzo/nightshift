import { describe, expect, test } from "bun:test";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import type { Actor } from "../../../contract";
import { HOSTED_ELSEWHERE } from "../../keep";
import { inMemoryCatalogPorts } from "../adapters/out/in-memory-neighbours";
import { addProjectWithoutFolder } from "./add-project-without-folder";

const ADA: Actor = { personId: "person-ada", door: "session" };

describe("addProjectWithoutFolder", () => {
	test("is refused in a Space whose Projects move", async () => {
		const ports = inMemoryCatalogPorts();
		ports.repos.add("/work/late", "git@github.com:acme/late.git");
		ports.spaceHolds.held.add("s1");
		await expect(
			addProjectWithoutFolder(ports)(ADA, {
				spaceId: "s1",
				name: "Late",
			}),
		).rejects.toThrow("held");
		expect(ports.spaceProjects.documentOf("s1").projects.size).toBe(0);
		expect(ports.projectLog.facts).toEqual([]);
	});

	test("has no remote and no Clone, in the Space document and its row; a name may repeat", async () => {
		const ports = inMemoryCatalogPorts();
		const added = await addProjectWithoutFolder(ports)(ADA, {
			spaceId: "s1",
			name: "Market watch",
		});
		expect(added).toMatchObject({
			name: "Market watch",
			remote: null,
			folder: false,
			repoPath: null,
			clones: [],
		});
		expect(ports.projectLog.facts).toEqual([
			{
				type: "ProjectAdded",
				payload: {
					projectId: added.id,
					name: "Market watch",
					remote: null,
					folder: false,
				},
			},
		]);
		const again = await addProjectWithoutFolder(ports)(ADA, {
			spaceId: "s1",
			name: "Market watch",
		});
		expect(again.id).not.toBe(added.id);
	});

	test("in a Space a Host keeps, the Host adds it, and its row is here at once", async () => {
		const ports = inMemoryCatalogPorts();
		ports.directory.hostElsewhere("team");
		const added = await addProjectWithoutFolder(ports)(ADA, {
			spaceId: "team",
			name: "Leads",
		});
		expect(added).toMatchObject({
			id: "hosted-1",
			name: "Leads",
			folder: false,
		});
		expect(ports.relay.asked).toEqual(["addWithoutFolder team Leads"]);
		const { relay: _, ...alone } = ports;
		await expect(
			addProjectWithoutFolder(alone)(ADA, { spaceId: "team", name: "Leads" }),
		).rejects.toThrow(HOSTED_ELSEWHERE);
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = inMemoryCatalogPorts();
		expect(
			await ports.access.whoMay(
				"s1",
				(actor) =>
					addProjectWithoutFolder(ports)(actor, {
						spaceId: "s1",
						name: "Leads",
					}),
				() => ports.projectLog.facts,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
