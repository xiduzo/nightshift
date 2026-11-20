import { describe, expect, test } from "bun:test";
import { inMemoryStorePorts } from "../adapters/out/in-memory-neighbours";
import { dismissProjectFlowNotice } from "./dismiss-project-flow-notice";

const notice = {
	id: "n-1",
	at: 1,
	deviceId: "laptop",
	kind: "folder-kept",
	message: "Kept.",
};

describe("dismissProjectFlowNotice", () => {
	test("removes the notice, and one that is gone is no error", async () => {
		const ports = inMemoryStorePorts();
		ports.store.seed("project", [notice]);
		const dismiss = dismissProjectFlowNotice(ports);
		await dismiss({ projectId: "project", noticeId: "n-1" });
		await dismiss({ projectId: "project", noticeId: "n-1" });
		expect(await ports.store.notices("project")).toEqual([]);
	});

	test("refuses a Project this Replica does not have", async () => {
		const ports = inMemoryStorePorts();
		const dismiss = dismissProjectFlowNotice(ports)({
			projectId: "gone",
			noticeId: "n-1",
		});
		await expect(dismiss).rejects.toThrow("This project does not exist.");
	});
});
