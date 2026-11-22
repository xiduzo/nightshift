import { project } from "@nightshift/db/schema";
import { now } from "@nightshift/time";
import { createRunLog } from "../../../../log";
import { knowledgeUseEvent } from "../../../../log/events/knowledge-use";
import { createSandbox } from "../../../../testing";
import { drizzleKnowledgeUseLog } from "./drizzle-knowledge-use-log";
import { inMemoryKnowledgeUseLog } from "./in-memory-knowledge-use-log";
import { knowledgeUseLogContract } from "./knowledge-use-log.contract";

/**
 * The contract of `KnowledgeUseLog`, on both adapters. The real side runs
 * on a sandbox's database, with two projects, and logs each use as the
 * MCP server does (`knowledgeUseEvent`).
 */

knowledgeUseLogContract("in memory", async () => {
	const knowledgeUseLog = inMemoryKnowledgeUseLog();
	return {
		knowledgeUseLog,
		async log(projectId, use) {
			const at = now();
			knowledgeUseLog.log(
				projectId,
				use.kind === "search"
					? {
							type: "KnowledgeSearched",
							at,
							runId: null,
							stepId: null,
							payload: {
								query: use.query,
								hits: use.paths.map((path) => ({
									path,
									section: null,
									line: 1,
									page: null,
									found: ["words"],
								})),
							},
						}
					: {
							type: "KnowledgeRead",
							at,
							runId: null,
							stepId: null,
							payload: { path: use.path, found: use.found },
						},
			);
		},
		close: async () => {},
	};
});

knowledgeUseLogContract("over drizzle, on a sandbox", async () => {
	const sandbox = await createSandbox();
	for (const id of ["p1", "p2"]) {
		await sandbox.db
			.insert(project)
			.values({ id, spaceId: sandbox.spaceId, name: id });
	}
	const log = createRunLog(sandbox.db, {
		walkerId: sandbox.deviceId,
		dataDir: sandbox.dataDir,
	});
	return {
		knowledgeUseLog: drizzleKnowledgeUseLog(sandbox.db),
		async log(projectId, use) {
			await log.append(
				knowledgeUseEvent(
					projectId,
					use.kind === "search"
						? {
								kind: "search",
								query: use.query,
								hits: use.paths.map((path) => ({
									path,
									section: null,
									line: 1,
									page: null,
									found: ["words"],
								})),
							}
						: { kind: "read", path: use.path, found: use.found },
					"mcp",
				),
			);
		},
		close: () => sandbox.cleanup(),
	};
});
