import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Refusal } from "@nightshift/refusal";
import { projectFlowsContract } from "../testing/project-flows-contract";
import { seedFlowFolder } from "../testing/seed-flows";
import { type FileProjectFlowsDeps, fileProjectFlows } from "./project-flows";

const NOT_HERE = "Not on this computer.";

/** A Clone of a project in a temp folder. */
async function clone(): Promise<{
	repoPath: string;
	dispose(): Promise<void>;
}> {
	const repoPath = await mkdtemp(join(tmpdir(), "nightshift-project-flows-"));
	return {
		repoPath,
		dispose: () => rm(repoPath, { recursive: true, force: true }),
	};
}

function inClone(repoPath: string): FileProjectFlowsDeps {
	return {
		find: async () => ({ repoPath }),
		get: async () => ({ repoPath }),
		elsewhere: async () => {
			throw new Error("Read elsewhere with a Clone here.");
		},
	};
}

projectFlowsContract("the file adapter", async () => {
	const { repoPath, dispose } = await clone();
	return {
		flows: fileProjectFlows(inClone(repoPath)),
		of: { projectId: "project", spaceId: "space" },
		dispose,
	};
});

describe("fileProjectFlows", () => {
	test("reads the flow files of the Clone here, with their paths", async () => {
		const { repoPath, dispose } = await clone();
		try {
			await seedFlowFolder(repoPath, { quick: { version: 1 } });
			const set = await fileProjectFlows(inClone(repoPath)).flows({
				projectId: "project",
			});
			expect(set.sources).toEqual({ quick: { json: { version: 1 } } });
			expect(set.pathOf("quick")).toBe(
				join(repoPath, ".nightshift", "flows", "quick.json"),
			);
		} finally {
			await dispose();
		}
	});

	test("a Person in a Space without a Clone here reads another of their Devices", async () => {
		const asked: unknown[] = [];
		const flows = fileProjectFlows({
			find: async () => ({ repoPath: null }),
			get: async () => {
				throw new Refusal("conflict", NOT_HERE);
			},
			elsewhere: async (...args) => {
				asked.push(args);
				return { quick: { json: {} } };
			},
		});
		const set = await flows.flows({
			projectId: "project",
			spaceId: "space",
			personId: "person",
		});
		expect(asked).toEqual([["space", "project", "person"]]);
		expect(set.sources).toEqual({ quick: { json: {} } });
		expect(set.pathOf("quick")).toBe(
			join(".nightshift", "flows", "quick.json"),
		);
	});

	test("a read outside a Space, and every save, need the Clone here", async () => {
		const flows = fileProjectFlows({
			find: async () => ({ repoPath: null }),
			get: async () => {
				throw new Refusal("conflict", NOT_HERE);
			},
			elsewhere: async () => ({}),
		});
		const of = { projectId: "project", spaceId: "space" };
		for (const attempt of [
			() => flows.flows({ projectId: "project" }),
			() => flows.schedules({ projectId: "project" }),
			() => flows.save(of, "quick", {} as never),
			() => flows.remove(of, "quick"),
			() => flows.saveSchedules(of, []),
		]) {
			await expect(attempt()).rejects.toThrow(NOT_HERE);
		}
	});
});
