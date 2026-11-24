import { describe, expect, test } from "bun:test";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { dismissFlowNotice } from "./dismiss-flow-notice";

const ada = { personId: "ada", door: "session" } as const;
const notice = {
	id: "n-1",
	at: 1,
	deviceId: "laptop",
	kind: "folder-kept",
	message: "Kept.",
};

describe("dismissFlowNotice", () => {
	test("removes a notice of a project of the Space", async () => {
		const ports = inMemoryEditingPorts();
		ports.flows.store.seed("project", [notice]);
		await dismissFlowNotice(ports)(ada, {
			spaceId: "space",
			projectId: "project",
			noticeId: "n-1",
		});
		expect(await ports.flows.notices("project")).toEqual([]);
	});

	test("a project of another Space is not found, and its notice stays", async () => {
		const ports = inMemoryEditingPorts();
		ports.flows.store.seed("elsewhere", [notice]);
		const dismiss = dismissFlowNotice(ports)(ada, {
			spaceId: "space",
			projectId: "elsewhere",
			noticeId: "n-1",
		});
		await expect(dismiss).rejects.toThrow("This project does not exist.");
		expect(await ports.flows.notices("elsewhere")).toEqual([notice]);
	});

	test("asks flow:save: owners, admins and members may, and nobody else", async () => {
		const ports = inMemoryEditingPorts();
		const dismissed: string[] = [];
		const flows = {
			dismissNotice: async (_project: string, id: string) => {
				dismissed.push(id);
			},
		};
		expect(
			await ports.access.whoMay(
				"space",
				(actor) =>
					dismissFlowNotice({ ...ports, flows })(actor, {
						spaceId: "space",
						projectId: "project",
						noticeId: "n-1",
					}),
				() => dismissed,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
