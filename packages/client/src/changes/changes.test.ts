import { describe, expect, test } from "bun:test";
import { appRouter } from "@nightshift/api";

import {
	documentOf,
	heldByDocuments,
	SAVES,
	savedBy,
	staleAfter,
} from "./changes";

/** Every procedure of the router, by its dotted path (`flows.save`). */
function proceduresOf(router: object, prefix = ""): string[] {
	return Object.entries(router).flatMap(([key, value]) =>
		typeof value === "object" && value !== null && "~orpc" in value
			? [`${prefix}${key}`]
			: proceduresOf(value as object, `${prefix}${key}.`),
	);
}

/**
 * The procedures that only read: a screen reads them as a query. Three a
 * screen calls as a mutation, but they write nothing: a test of a
 * connection or of an address, and the folder picker.
 */
const READS = new Set([
	"healthCheck",
	"spaces.list",
	"members.list",
	"invitations.get",
	"projects.list",
	"projects.branches",
	"projects.check",
	"projects.chooseFolder",
	"projects.sources",
	"projects.gitHubRepos",
	"projects.gitHubClone",
	"projects.copies",
	"projects.secrets",
	"projects.spaceSecrets",
	"knowledge.get",
	"knowledge.review",
	"knowledge.files",
	"knowledge.learnings",
	"knowledge.search",
	"knowledge.meaning",
	"knowledge.read",
	"knowledge.questions",
	"knowledge.graph",
	"knowledge.evaluate",
	"knowledge.use",
	"flows.list",
	"flows.get",
	"flows.map",
	"flows.kept",
	"flows.memory",
	"flows.notices",
	"flows.revisions",
	"flows.revision",
	"flows.export",
	"gates.list",
	"gates.answered",
	"schedules.list",
	"schedules.preview",
	"runs.placements",
	"runs.list",
	"runs.get",
	"runs.step",
	"runs.stepTranscript",
	"runs.serviceLog",
	"runs.artifacts",
	"runs.files",
	"runs.moveTargets",
	"runs.devices",
	"notifications.settings.get",
	"notifications.targets.list",
	"notifications.webPush.key",
	"dashboard.summary",
	"dashboard.flow",
	"dashboard.changes",
	"dashboard.spend",
	"settings.get",
	"usage.outbox",
	"usage.catalog",
	"connections.list",
	"connections.check",
	"connections.test",
	"connections.tools",
	"cliTools.list",
	"cliTools.programs",
	"cliTools.check",
	"programs.found",
	"harnesses.list",
	"harnesses.models",
	"harnesses.skills",
	"agentSetup.status",
	"deciderSetup.status",
	"deciders.list",
	"deciders.modelsAt",
	"ollama.status",
	"ollama.models",
	"profiles.list",
	"profiles.catalog",
	"offers.list",
	"devices.list",
	"devices.others",
	"devices.space",
	"devices.phones",
	"devices.merge.pending",
	"devices.merge.preview",
	"account.status",
	"assistant.agents",
	// A check asks an agent one question and writes nothing.
	"assistant.check",
]);

/** The streams: a screen follows them, they save nothing. */
const STREAMS = new Set([
	"assistant.suggest",
	"assistant.chat",
	"assistant.explain",
	"runs.watch",
	"notifications.watch",
	"devices.join",
]);

/** What only a paired Device calls: the peer protocol. */
const PEER = [
	"pairing.",
	"link.",
	"sync.",
	"archive.",
	"leases.",
	"secrets.",
	"projectSecrets.",
	"spaceSecrets.",
	"devices.work",
	"devices.call",
	"devices.stop",
	"devices.reachable",
	"devices.workReply",
];

describe("the save routes", () => {
	const procedures = proceduresOf(appRouter);
	const ofPeer = (path: string) =>
		PEER.some((peer) => path === peer || path.startsWith(peer));

	test("each route of the API that a screen calls and that is not a read has a row", () => {
		expect(procedures.length).toBeGreaterThan(200);
		const missing = procedures.filter(
			(path) =>
				!READS.has(path) &&
				!STREAMS.has(path) &&
				!ofPeer(path) &&
				!(path in SAVES),
		);
		// A new route: say what it writes in `SAVES`, or add it to the reads here.
		expect(missing).toEqual([]);
	});

	test("are routes of the API, and none of them is a read", () => {
		const known = new Set(procedures);
		for (const path of Object.keys(SAVES)) {
			expect(known.has(path), path).toBe(true);
			expect(READS.has(path) || STREAMS.has(path) || ofPeer(path), path).toBe(
				false,
			);
		}
	});

	test("a route is found by the first part of its mutation key", () => {
		expect(savedBy(["flows", "save"])).toEqual(["flows", "flows-history"]);
		expect(savedBy(["devices", "merge", "run"])).toEqual([]);
		expect(savedBy(["flows", "list"])).toEqual([]);
	});
});

describe("what a change makes stale", () => {
	test("a flow reads the lists that name the flows that use something", () => {
		expect(staleAfter(["flows"])).toEqual([
			["schedules", "list"],
			["flows"],
			["profiles", "list"],
			["connections", "list"],
			["cliTools", "list"],
			["projects", "secrets"],
			["projects", "spaceSecrets"],
			["knowledge", "get"],
			["knowledge", "review"],
		]);
	});

	test("a run reads the lists that count it, and what its steps keep for the next run", () => {
		expect(staleAfter(["runs"])).toEqual([
			["runs", "list"],
			["dashboard"],
			["schedules", "list"],
			["projects", "list"],
			["knowledge", "learnings"],
			["knowledge", "review"],
			["flows", "kept"],
			["flows", "memory"],
		]);
	});

	test("this computer's document reads its configuration, the checks of its CLIs included", () => {
		expect(staleAfter(["device"])).toEqual([
			["profiles"],
			["settings"],
			["offers"],
			["deciders"],
			["connections"],
			["harnesses"],
			["cliTools"],
			["assistant", "agents"],
		]);
	});

	test("reads each path once, and not a path below another one", () => {
		// The Space reads every read of projects: the lists that count runs need no own read.
		expect(staleAfter(["runs", "space"])).toEqual([
			["runs", "list"],
			["dashboard"],
			["schedules", "list"],
			["knowledge", "learnings"],
			["knowledge", "review"],
			["flows", "kept"],
			["flows", "memory"],
			["spaces"],
			["members"],
			["projects"],
		]);
		// The flows read their history too.
		expect(staleAfter(["flows", "flows-history"])).toEqual(
			staleAfter(["flows"]),
		);
		expect(staleAfter([])).toEqual([]);
	});
});

describe("the reads a synced document holds", () => {
	test("are the reads only a document changes, each once", () => {
		expect(heldByDocuments()).toEqual([
			["flows", "list"],
			["flows", "get"],
			["flows", "map"],
			["flows", "notices"],
			["flows", "export"],
			["schedules", "list"],
			["flows", "revisions"],
			["flows", "revision"],
			["knowledge"],
			["projects", "list"],
			["spaces"],
			["members"],
			["dashboard"],
			["profiles"],
			["connections", "list"],
			["harnesses", "list"],
			["cliTools", "list"],
			["settings"],
			["offers"],
			["deciders"],
		]);
	});

	test("are each read again when their document changes", () => {
		const documents = staleAfter([
			"flows",
			"flows-history",
			"knowledge",
			"space",
			"device",
			"device-copy",
		]);
		for (const held of heldByDocuments()) {
			expect(
				documents.some((path) => path.every((part, at) => held[at] === part)),
				held.join("."),
			).toBe(true);
		}
	});
});

describe("the kind of a synced document", () => {
	test("is the prefix of its name, or null for a name this screen does not know", () => {
		expect(documentOf("flows:shop")).toBe("flows");
		expect(documentOf("flows-history:shop")).toBe("flows-history");
		expect(documentOf("device-copy:laptop")).toBe("device-copy");
		expect(documentOf("device")).toBe("device");
		expect(documentOf("notes:shop")).toBeNull();
	});
});
