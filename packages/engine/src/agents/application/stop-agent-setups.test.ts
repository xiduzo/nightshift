import { describe, expect, test } from "bun:test";
import { createAgentJobs } from "../domain/setup-jobs";
import { stopAgentSetups } from "./stop-agent-setups";

describe("stopAgentSetups", () => {
	test("stops every running job", () => {
		const jobs = createAgentJobs();
		jobs.begin("codex");
		stopAgentSetups({ jobs })({});
		expect(jobs.jobOf("codex").state).toBe("cancelled");
	});
});
