import { describe, expect, test } from "bun:test";
import { createDeciderJob } from "../domain/setup-jobs";
import { stopDeciderSetups } from "./stop-decider-setups";

describe("stopDeciderSetups", () => {
	test("cancels a running job", () => {
		const job = createDeciderJob();
		job.begin().set({ state: "starting", since: 1 });
		stopDeciderSetups({ job })({});
		expect(job.read().state).toBe("cancelled");
	});
});
