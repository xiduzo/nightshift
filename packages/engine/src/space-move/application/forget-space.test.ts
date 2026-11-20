import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { inMemorySpaceMovePorts } from "../adapters/out/in-memory-neighbours";
import { forgetSpace } from "./forget-space";

/** The use case forgetSpace, on in-memory adapters. */

/** Space `gone`, its row removed, with two facts of no run, a fact of a run that is gone and an answer cost. */
function emptied() {
	const ports = inMemorySpaceMovePorts();
	ports.rows.events.push(
		{ spaceId: "gone", runId: null },
		{ spaceId: "gone", runId: null },
		{ spaceId: "gone", runId: "moved-away" },
		{ spaceId: "kept", runId: null },
	);
	ports.rows.answerCosts.push({ spaceId: "gone" }, { spaceId: "kept" });
	ports.entries.documents.set("gone", { projects: new Map(), clones: [] });
	return ports;
}

describe("forgetSpace", () => {
	test("once a move emptied it, its facts of no run, its answer costs and its document go; another Space keeps everything", async () => {
		const ports = emptied();
		expect(await forgetSpace(ports)({ spaceId: "gone" })).toBe(true);
		expect(ports.rows.events).toEqual([{ spaceId: "kept", runId: null }]);
		expect(ports.rows.answerCosts).toEqual([{ spaceId: "kept" }]);
		expect(ports.entries.documents.has("gone")).toBe(false);
		expect(ports.entries.calls).toEqual(["forget gone"]);
	});

	test("is refused while the Space's own row is here: nothing goes", async () => {
		const ports = emptied();
		ports.rows.spaces.add("gone");
		expect(await forgetSpace(ports)({ spaceId: "gone" })).toBe(false);
		expect(ports.rows.events).toHaveLength(4);
		expect(ports.entries.calls).toEqual([]);
	});

	test("is refused while a Project or a run of it is here: nothing goes", async () => {
		const ports = emptied();
		ports.rows.runs.push({
			id: "r1",
			spaceId: "gone",
			projectId: "app",
			walkerId: "a",
		});
		expect(await forgetSpace(ports)({ spaceId: "gone" })).toBe(false);
		ports.rows.runs.length = 0;
		ports.rows.projects.set("app", {
			id: "app",
			spaceId: "gone",
			name: "App",
			remote: null,
			folder: true,
			createdAt: asDate(0),
			removedAt: null,
		});
		expect(await forgetSpace(ports)({ spaceId: "gone" })).toBe(false);
		expect(ports.rows.answerCosts).toHaveLength(2);
		expect(ports.entries.calls).toEqual([]);
	});
});
