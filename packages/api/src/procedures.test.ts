import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";
import {
	type HostPolicy,
	type Permissions,
	personalSpaceId,
	type Role,
	requestAccess,
	roleAllows,
	TRUSTED_BROWSER_DAYS,
} from "@nightshift/auth";
import {
	type AuthSandbox,
	createAuthSandbox,
	OPEN_HOST,
	TWO_FACTOR_REQUIRED,
	turnOnTwoFactor,
} from "@nightshift/auth/testing";
import { hostRouter } from "@nightshift/devices";
import {
	GateClosedError,
	HOST_UNREACHABLE,
	HostUnreachableError,
	type OpenGate,
	type SpaceEngine,
} from "@nightshift/engine";
import { PROJECT_NOT_FOUND } from "@nightshift/engine/projects";
import { singleAgentFlow } from "@nightshift/flows";
import {
	FAILURE_MESSAGE,
	Refusal,
	type RefusalKind,
} from "@nightshift/refusal";
import { type AnyProcedure, call, isProcedure, ORPCError } from "@orpc/server";

import type { Context, Services } from "./context";
import { onOutputMismatch } from "./output";
import { readable } from "./procedures";
import { appRouter } from "./router";
import { runAccess } from "./runs";
import { accessAs } from "./testing";

/**
 * The procedures as a table: each route needs a permission, forwards to
 * one member of the daemon's services with the arguments its input gives,
 * and every error ends in the one rule at the API seam (`readable`). The
 * fake services record every call and answer anything: these tests check
 * sessions, roles and the member each route calls, not replies.
 * `contract.test.ts` checks the replies against a real engine.
 */

// ---------------------------------------------------------------------------
// The fake services: every member records its call and answers `anything`.

/** One call of a service: the Space for a call of the Space view, the member, its arguments. */
type Call = { space?: string; method: string; args: unknown[] };

/**
 * A value that stands for any reply: it has every member, each a function
 * that gives it again, it iterates as nothing, spreads as nothing and
 * awaits as itself. A handler that reads a reply reads it without a throw.
 */
const anything: unknown = new Proxy(() => {}, {
	get(_, key) {
		if (key === "then") return undefined;
		if (key === Symbol.iterator) return function* () {};
		if (key === Symbol.asyncIterator) return async function* () {};
		if (key === Symbol.toPrimitive) return () => "";
		return anything;
	},
	apply: () => anything,
	ownKeys: () => [],
	has: () => false,
	getOwnPropertyDescriptor: () => undefined,
});

/** What a fake answers for a member, when not `anything`. `undefined`: anything. */
type Reply = (method: string, args: unknown[]) => unknown;

/**
 * A service whose every member records its call under `path` and answers
 * `reply` or `anything`. A member in `given` is the test's own.
 */
function recorder(
	path: string[],
	record: (method: string, args: unknown[]) => void,
	options: { given?: Record<string, unknown>; reply?: Reply } = {},
): unknown {
	return new Proxy(() => {}, {
		get(_, key) {
			if (typeof key === "symbol" || key === "then") return undefined;
			if (options.given && key in options.given) return options.given[key];
			return recorder([...path, key], record, { reply: options.reply });
		},
		has: () => true,
		apply(_, __, args) {
			const method = path.join(".");
			record(method, args);
			const answer = options.reply?.(method, args);
			return answer === undefined ? anything : answer;
		},
	});
}

/** Every service the Context has: each gets a recorder. */
const SERVICES: Record<keyof Services, true> = {
	devices: true,
	exchange: true,
	offers: true,
	db: true,
	engine: true,
	settings: true,
	notifications: true,
	connections: true,
	cliTools: true,
	toolLaunchers: true,
	profiles: true,
	knowledge: true,
	ollama: true,
	assistant: true,
	checks: true,
	projectSetup: true,
	usage: true,
	daemon: true,
};

/** The members a test gives itself, per service, and of the Space view. */
type Given = {
	[K in keyof Services | "space"]?: Record<string, unknown>;
} & { fromThisComputer?: boolean };

/** The Space each run is in, for `engine.spaceOfRun`. */
let runSpaces: Map<string, string>;
/** The open Gates the fake Space view lists, per Space. */
let gatesIn: Map<string, OpenGate[]>;
/** What the fake Space view's answer to a Gate (`act.answer`) does after it records the call. */
let onResolve: () => void;
/** Every call of a fake service, in order. */
let calls: Call[];

/** The fake daemon's facts: this computer is `OWNER`'s. */
const OWNER = "ada";
const daemonOf = (ownerId: string): Services["daemon"] => ({
	dataDir: "/tmp",
	device: { id: "device", name: "test", ownerId },
	lease: { host: "test", pid: 1, epoch: 1, since: 0 },
});

/**
 * The context of a request with `access`, on a computer `ownerId` owns,
 * over recording services. The Space view of each Space records its
 * calls with the Space, an action as `act.<kind>`. The database is real:
 * the procedures that read the Person's Spaces or Members read it.
 */
function recording(
	db: Context["db"],
	access: Context["access"],
	options: {
		ownerId?: string;
		given?: Given;
		deviceKey?: Context["deviceKey"];
	} = {},
): Context {
	const { ownerId = OWNER, given = {}, deviceKey = null } = options;
	const space = (spaceId: string) =>
		recorder(
			["space"],
			(method, args) => {
				const member = method.slice("space.".length);
				calls.push({
					space: spaceId,
					method:
						member === "act"
							? `act.${(args[1] as { kind: string }).kind}`
							: member,
					args,
				});
			},
			{
				given: given.space,
				reply: (method, args) => {
					if (
						method === "space.act" &&
						(args[1] as { kind: string }).kind === "answer"
					) {
						return (async () => onResolve())();
					}
					if (method === "space.listGates") return gatesIn.get(spaceId) ?? [];
					if (method === "space.watchRun") return (async function* () {})();
					if (method === "space.listRuns") return [];
					return undefined;
				},
			},
		) as SpaceEngine;
	const record = (method: string, args: unknown[]) => {
		calls.push({ method, args });
	};
	const services = {} as Record<keyof Services, unknown>;
	for (const name of Object.keys(SERVICES) as (keyof Services)[]) {
		services[name] = recorder([name], record, { given: given[name] });
	}
	services.engine = recorder(["engine"], record, {
		given: {
			space,
			spaceOfRun: async (runId: string) => runSpaces.get(runId) ?? null,
			...given.engine,
		},
	});
	services.db = db;
	services.daemon = daemonOf(ownerId);
	return {
		...(services as Services),
		access,
		fromThisComputer: given.fromThisComputer ?? false,
		deviceKey,
		requireTwoFactor: false,
		setLogin: recorder(["setLogin"], record) as Context["setLogin"],
	};
}

// ---------------------------------------------------------------------------
// The route table.

/** Who may call a route. */
type Need =
	| "public"
	| "session"
	| "owner"
	| Permissions
	| { owner: true; role: Permissions };

/** One route: its path, an input, who may call it, the member it calls with which arguments. */
type Route = {
	path: string;
	input?: unknown;
	needs: Need;
	/** The members it must call (`space.flows.list`, `devices.others`). */
	calls?: string | string[];
	/** The arguments of the first of `calls`. */
	args?: unknown[];
	/** The members the route needs beyond the recorders. */
	given?: Given;
	/** The code the call ends in with the fakes, when not a reply. */
	ends?: string;
};

const SPACE = "space-1";
const PERSON = OWNER;
const flow = singleAgentFlow({
	prompt: "Fix it",
	model: "sonnet",
	permissionMode: "acceptEdits",
});
const run = { runId: "r" };
const project = { projectId: "p1" };
const flowRef = { ...project, name: "night" };
const at = { spaceId: SPACE, ...project };
const secret = { name: "GH_TOKEN" };
const schedule = { id: "nightly", flow: "night", cron: "0 22 * * 1-5" };
const one = { ...project, scheduleId: "nightly" };
const learning = { ...project, id: "l1" };
const server = { command: "gh-mcp", args: [], env: {} };
const screen = {
	kind: "web" as const,
	name: "This browser",
	endpoint: "https://fcm.googleapis.com/fcm/send/abc",
	keys: { p256dh: "key", auth: "secret" },
};
const inEditor = { ...project, flowName: "fix", flow };
const SAVE: Permissions = { flow: ["save"] };
const START: Permissions = { run: ["start"] };
const STOP: Permissions = { run: ["stop"] };
const RESUME: Permissions = { run: ["resume"] };
const OWNER_SAVING = { owner: true as const, role: SAVE };
const any = expect.anything();
/** The route's input after its schema: the fields given, and more. */
const like = (fields: Record<string, unknown>) =>
	expect.objectContaining(fields);
const settingsOf = () => ({ harnesses: [], customAgents: [] });

const webSource = {
	kit: "kit:knowledge/web" as const,
	inputs: { urls: "https://example.org" },
};
/** A connection that names one server, as a test of it reads it. */
const expandForTest = async () => ({
	expansion: { ok: true as const, servers: { gh: server } },
	values: [] as string[],
});
const agentProfile = {
	name: "fast",
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
	clis: [],
	connections: [],
};
const offer = { spaceId: SPACE, profile: "p-1" };

/** One row: the route's path, its input, who may call it, the member it calls with which arguments, and what more it needs. */
function route(
	path: string,
	input: unknown,
	needs: Need,
	calls?: string | string[],
	args?: unknown[],
	more: Pick<Route, "given" | "ends"> = {},
): Route {
	return { path, input, needs, calls, args, ...more };
}

// biome-ignore format: a table reads one route per line.
const ROUTES: Route[] = [
	route("healthCheck", undefined, "public"),
	// Spaces and Members.
	route("spaces.list", undefined, "session"),
	route("spaces.switch", { spaceId: SPACE }, "session", "access.setActiveSpace", [SPACE]),
	route("spaces.create", { name: " Platform " }, "session", "access.createSpace", ["Platform"]),
	route("spaces.setUsage", { enabled: true }, { space: ["settings"] }, "space.setUsage", [true]),
	route("members.list", undefined, "session"),
	route("members.invite", { email: "Dee@Example.com", role: "member" }, { member: ["invite"] }, "access.members.invite", ["dee@example.com", "member"]),
	route("members.cancelInvitation", { invitationId: "i" }, { member: ["invite"] }, "access.members.cancelInvitation", ["i"]),
	route("members.setRole", { memberId: "m", role: "viewer" }, { member: ["role"] }, "access.members.setRole", ["m", "viewer"]),
	route("members.remove", { memberId: "m" }, { member: ["remove"] }, "access.members.remove", ["m"]),
	route("invitations.get", { invitationId: "i" }, "public", undefined, undefined, { ends: "NOT_FOUND" }),
	route("invitations.accept", { invitationId: "i" }, "session", "access.members.accept", ["i"]),
	// Projects.
	route("projects.list", undefined, "session", ["space.listProjects", "space.projectRuns"]),
	route("projects.add", { repoPath: "/repo" }, { project: ["add"] }, ["space.addProject", "usage.note"], [{ repoPath: "/repo", name: undefined }]),
	route("projects.addWithoutFolder", { name: " Leads " }, { project: ["add"] }, "space.addProjectWithoutFolder", [{ name: "Leads" }]),
	route("projects.branches", project, "session", "space.listBranches", ["p1"]),
	route("projects.runCopies", project, "owner", "space.listRunCopies", ["p1"]),
	route("projects.removeRunCopy", run, "owner", "space.removeRunCopy", ["r", { force: undefined }]),
	route("projects.deleteRunBranches", { ...run, force: true }, "owner", "space.deleteRunBranches", ["r", { force: true }]),
	route("projects.check", { path: "/repo" }, "owner", ["projectSetup.check", "usage.note"], ["/repo"]),
	route("projects.setUpGit", { path: "/repo" }, "owner", ["projectSetup.setUpGit", "usage.note"], [{ path: "/repo" }]),
	route("projects.installGit", undefined, "owner", "projectSetup.installGit", []),
	route("projects.chooseFolder", { purpose: "use" }, "owner", "projectSetup.chooseFolder", ["Choose the folder of this project on this computer"]),
	route("projects.sources", undefined, "owner", "projectSetup.gitHub.access"),
	route("projects.gitHubRepos", undefined, "owner", "projectSetup.gitHub.repos", []),
	route("projects.cloneFromGitHub", { repo: "o/r" }, "owner", "projectSetup.gitHub.start", ["o/r"]),
	route("projects.gitHubClone", { repo: "o/r" }, "owner", "projectSetup.gitHub.status", ["o/r"]),
	route("projects.copies", undefined, "session", ["space.listProjects", "projectSetup.copies.list"]),
	route("projects.copyHere", project, "owner", ["space.listProjects", "projectSetup.copies.copy"]),
	route("projects.useFolder", { ...project, repoPath: "/repo" }, "owner", "space.useProjectFolder", ["p1", "/repo"]),
	route("projects.remove", project, { project: ["remove"] }, "space.removeProject", ["p1"]),
	route("projects.rename", { ...project, name: " App " }, { project: ["add"] }, "space.renameProject", ["p1", "App"]),
	route("projects.move", { ...project, spaceId: SPACE }, { project: ["move"] }, "space.moveProject", ["p1", SPACE]),
	// A project's secrets, and the Space's (ADR 13, 18).
	route("projects.secrets", project, "session", ["space.listProjects", "connections.projectSecrets"]),
	route("projects.setSecret", { ...project, ...secret, value: "v" }, SAVE, "connections.setProjectSecret", [at, "GH_TOKEN", "v", PERSON]),
	route("projects.removeSecret", { ...project, ...secret }, SAVE, "connections.removeProjectSecret", [at, "GH_TOKEN", PERSON]),
	route("projects.moveSecretOut", { ...project, ...secret, to: "personal" }, OWNER_SAVING, "connections.moveFromProject", [at, "GH_TOKEN", "personal", PERSON]),
	route("projects.moveSecretIn", { ...project, ...secret, from: "personal" }, OWNER_SAVING, "connections.moveToProject", ["GH_TOKEN", "personal", at, PERSON]),
	route("projects.spaceSecrets", undefined, "session", ["connections.spaceSecrets", "space.flowUse"], [SPACE, PERSON]),
	route("projects.setSpaceSecret", { ...secret, value: "v" }, SAVE, "connections.setSpaceSecret", [SPACE, "GH_TOKEN", "v", PERSON]),
	route("projects.removeSpaceSecret", secret, SAVE, "connections.removeSpaceSecret", [SPACE, "GH_TOKEN", PERSON]),
	route("projects.moveSecretToSpace", { ...secret, from: "personal" }, OWNER_SAVING, "connections.moveToSpace", ["GH_TOKEN", "personal", SPACE, PERSON]),
	route("projects.moveSecretFromSpace", { ...secret, to: "personal" }, OWNER_SAVING, "connections.moveFromSpace", [SPACE, "GH_TOKEN", "personal", PERSON]),
	route("projects.moveSecretFromDevice", { ...project, ...secret, deviceId: "laptop" }, OWNER_SAVING, "devices.moveSecretOn", ["laptop", "GH_TOKEN", { to: "project", ...at }]),
	// Knowledge (ADR 4).
	route("knowledge.get", project, "session", ["space.listProjects", "knowledge.sources"]),
	route("knowledge.review", project, "session", "knowledge.review", ["p1", any]),
	route("knowledge.files", project, "session", "knowledge.listing", ["p1"]),
	route("knowledge.learnings", project, "session", "knowledge.learnings", [["p1"]]),
	route("knowledge.keepLearning", learning, START, "knowledge.settleLearning", ["p1", "l1", "keep"]),
	route("knowledge.deleteLearning", learning, START, "knowledge.settleLearning", ["p1", "l1", "delete"]),
	route("knowledge.saveSource", { ...project, source: webSource }, SAVE, "knowledge.sources", [any]),
	route("knowledge.removeSource", { ...flowRef, removeFiles: false }, { flow: ["remove"] }, "knowledge.sources", [any]),
	route("knowledge.syncSource", flowRef, START, "knowledge.sources", [any]),
	route("knowledge.search", { ...project, query: "docs" }, "session", "knowledge.search", ["p1", "docs", {}]),
	route("knowledge.meaning", project, "session", "knowledge.meaning", ["p1"]),
	route("knowledge.read", { ...project, path: "a.md" }, "session", "knowledge.read", ["p1", "a.md", { maxBytes: 1024 * 1024 }]),
	route("knowledge.questions", project, "session", "knowledge.questions", ["p1", {}]),
	route("knowledge.graph", project, "session", "knowledge.map", ["p1"]),
	route("knowledge.markNotTopic", { ...project, word: "the", notTopic: true }, START, "knowledge.markNotTopic", ["p1", { word: "the", notTopic: true, by: PERSON }]),
	route("knowledge.markQuestion", { ...project, query: "q", answers: ["a.md"] }, START, "knowledge.markQuestion", ["p1", { query: "q", answers: ["a.md"], by: PERSON }]),
	route("knowledge.evaluate", project, "session", "knowledge.evaluate", ["p1"]),
	route("knowledge.setMeaning", { ...project, on: true }, START, "knowledge.setMeaning", ["p1", true]),
	route("knowledge.use", project, "session", "knowledge.use", ["p1"]),
	// Flows.
	route("flows.list", project, "session", "space.flows.list", ["p1"]),
	route("flows.get", flowRef, "session", "space.flows.get", ["p1", "night"]),
	route("flows.map", project, "session", "space.flows.map", ["p1"]),
	route("flows.save", { ...flowRef, flow }, SAVE, "space.flows.save", ["p1", "night", flow]),
	route("flows.kept", flowRef, "session", "space.listKeptValues", ["p1", "night"]),
	route("flows.resetKept", { ...flowRef, variable: "count" }, "owner", "space.resetKeptValue", ["p1", "night", "count"]),
	route("flows.memory", flowRef, "session", "space.listNodeMemory", ["p1", "night"]),
	route("flows.forgetMemory", { ...flowRef, node: "call/fresh", scope: "feed" }, "owner", "space.forgetNodeMemory", ["p1", "night", "call/fresh", "feed"]),
	route("flows.notices", project, "session", "space.flows.notices", ["p1"]),
	route("flows.dismissNotice", { ...project, id: "n1" }, "owner", "space.flows.dismissNotice", ["p1", "n1"]),
	route("flows.remove", flowRef, { flow: ["remove"] }, "space.flows.remove", ["p1", "night"]),
	route("flows.revisions", flowRef, "session", "space.flows.revisions", ["p1", "night"]),
	route("flows.revision", { ...flowRef, revisionId: "rev", against: "old" }, "session", "space.flows.revision", ["p1", "night", "rev", "old"]),
	route("flows.restore", { ...flowRef, revisionId: "rev" }, SAVE, "space.flows.restore", ["p1", "night", "rev"]),
	route("flows.export", flowRef, "session", "space.flows.export", ["p1", "night"]),
	route("flows.import", { ...flowRef, json: "{}" }, SAVE, "space.flows.import", ["p1", "night", "{}", { agents: [] }]),
	route("flows.copy", { ...flowRef, toProjectId: "p2", as: "copy" }, SAVE, "space.flows.copy", ["p1", "night", { projectId: "p2", name: "copy" }]),
	// Gates: the Needs-you inbox.
	route("gates.list", undefined, "session"),
	route("gates.answered", undefined, "session"),
	route("gates.resolve", { ...run, stepId: "s", choice: "yes" }, { gate: ["resolve"] }, "space.act.answer", ["r", { kind: "answer", stepId: "s", choice: "yes", via: "_OTHER" }]),
	// The assistant.
	route("assistant.suggest", { ...inEditor, kind: "prompt", nodeId: "agent" }, "owner", "assistant.suggest", [like({ kind: "prompt", nodeId: "agent" }), any]),
	route("assistant.chat", { ...inEditor, message: "Hi." }, "owner", "assistant.chat", [like({ message: "Hi." }), any, { spaceId: SPACE, personId: PERSON }]),
	route("assistant.explain", run, RESUME, "assistant.explain", ["r", any, { spaceId: SPACE, personId: PERSON }]),
	// Schedules.
	route("schedules.list", project, "session", "space.listSchedules", ["p1"]),
	route("schedules.save", { ...project, schedules: [schedule] }, "owner", "space.saveSchedules", ["p1", [like(schedule)], undefined]),
	route("schedules.pauseTonight", one, STOP, ["space.pauseScheduleTonight", "notifications.schedulesChanged"], ["p1", "nightly"]),
	route("schedules.resumeTonight", one, STOP, ["space.resumeScheduleTonight", "notifications.schedulesChanged"], ["p1", "nightly"]),
	route("schedules.runNow", one, START, "space.runScheduleNow", ["p1", "nightly"]),
	route("schedules.preview", { cron: "0 22 * * 1-5" }, "session"),
	// Runs. A procedure keyed by a run id goes to the run's own Space.
	route("runs.placements", project, "session", "space.listPlacements", ["p1"]),
	route("runs.list", { projectId: "p1", limit: 10 }, "session", "space.listRuns", [{ projectId: "p1", limit: 10 }]),
	route("runs.get", run, "session", "space.getRun", ["r"]),
	route("runs.step", { ...run, stepId: "s" }, "session", "space.getStep", ["r", "s"]),
	route("runs.serviceLog", { ...run, nodeId: "n", scopeKey: "k" }, "session", "space.serviceLog", ["r", { nodeId: "n", scopeKey: "k" }]),
	route("runs.artifacts", run, "session", "space.listArtifacts", ["r"]),
	route("runs.start", { ...project, flowName: "night" }, START, "space.startRun", [{ projectId: "p1", flowName: "night", startedBy: PERSON }]),
	route("runs.useful", { ...run, useful: true }, STOP, "space.act.useful", ["r", { kind: "useful", useful: true }]),
	route("runs.stop", { ...run, when: "now" }, STOP, "space.act.stop", ["r", { kind: "stop", when: "now" }]),
	route("runs.move", { ...run, deviceId: "d2" }, { run: ["move"] }, "space.act.move", ["r", { kind: "move", to: "d2" }]),
	route("runs.releaseLease", { ...run, name: "deploy" }, STOP, "space.act.release-lease", ["r", { kind: "release-lease", name: "deploy" }]),
	route("runs.moveTargets", run, "session", "space.listMoveTargets", ["r"]),
	route("runs.devices", { ...project, forNode: { profile: "fast" } }, "session", "space.listDevices", ["p1", { profile: "fast" }]),
	route("runs.resume", { ...run, prompt: "Go." }, RESUME, "space.act.resume", ["r", { kind: "resume", prompt: "Go." }]),
	route("runs.restartStep", { ...run, stepId: "s", prompt: "Report now." }, RESUME, "space.act.restart", ["r", { kind: "restart", stepId: "s", prompt: "Report now." }]),
	route("runs.restartStep", run, RESUME, "space.act.restart", ["r", { kind: "restart" }]),
	route("runs.rerun", { ...run, nodeId: "worker", prompt: "Again.", fresh: true }, RESUME, "space.act.rerun", ["r", { kind: "rerun", nodeId: "worker", prompt: "Again.", fresh: true }]),
	route("runs.watch", run, "session", "space.watchRun", ["r", { signal: any, afterSeq: undefined }]),
	route("runs.signal", { ...run, name: "go" }, { signal: ["send"] }, "space.act.signal", ["r", { kind: "signal", name: "go" }]),
	route("runs.takeOver", run, RESUME, "space.act.take-over", ["r", { kind: "take-over" }]),
	// Notifications: the Person's own.
	route("notifications.watch", undefined, "session", "notifications.watch", [PERSON, any, { here: false, phone: false }]),
	route("notifications.settings.get", undefined, "session", "notifications.settings.get", [PERSON]),
	route("notifications.settings.save", { holdMinutes: 5 }, "session", "notifications.settings.save", [PERSON, { holdMinutes: 5 }]),
	route("notifications.targets.list", undefined, "session", "notifications.targets.list", [PERSON]),
	route("notifications.targets.register", screen, "session", "notifications.targets.register", [PERSON, like(screen), `session-${PERSON}`]),
	route("notifications.targets.remove", { id: "t1" }, "session", "notifications.targets.remove", [PERSON, "t1"]),
	route("notifications.webPush.key", undefined, "session", "notifications.webPush.publicKey", []),
	// The dashboard.
	route("dashboard.summary", { everySpace: false }, "session", ["space.listRuns", "space.listProjects"]),
	route("dashboard.flow", { ...project, flowName: "night", timeZone: "UTC" }, "session", "space.listRuns", [{ projectId: "p1" }]),
	// This computer's own configuration: its owner's.
	route("settings.get", undefined, "owner", "settings.view", []),
	route("settings.save", {}, "owner", "settings.save", [{}]),
	route("usage.outbox", undefined, "owner", "usage.outbox", []),
	route("usage.catalog", undefined, "owner", "usage.catalog", []),
	route("usage.resetId", undefined, "owner", "usage.resetId", []),
	route("connections.list", undefined, "owner", ["space.flowUse", "connections.secrets"]),
	route("connections.check", { target: "claude-code" }, "owner", ["checks.harness", "settings.current"], ["claude-code", any]),
	route("connections.save", { name: "gh", server }, "owner", "connections.save", [like({ name: "gh" })], { given: { connections: { get: () => undefined } } }),
	route("connections.remove", { name: "gh" }, "owner", ["connections.remove", "profiles.list"], ["gh"]),
	route("connections.test", { server }, "owner", "checks.mcp", undefined, { given: { connections: { expandForTest } } }),
	route("connections.tools", { name: "gh" }, "owner", "checks.mcp", undefined, { given: { connections: { expandForTest } } }),
	route("connections.setSecret", { ...secret, value: "v", scope: "personal" }, "owner", "connections.setSecret", ["GH_TOKEN", "v", "personal"]),
	route("connections.removeSecret", secret, "owner", "connections.removeSecret", ["GH_TOKEN", undefined]),
	route("connections.moveSecret", { ...secret, to: "personal" }, "owner", "connections.moveSecret", ["GH_TOKEN", "personal"]),
	route("cliTools.list", undefined, "owner", ["space.flowUse", "cliTools.list"]),
	route("cliTools.programs", undefined, "owner", "checks.programs", []),
	route("cliTools.check", { name: "jq" }, "owner", ["cliTools.program", "checks.cli"], ["jq"]),
	route("cliTools.save", { name: "jq" }, "owner", "cliTools.save", [like({ name: "jq" })]),
	route("cliTools.signIn", { name: "jq" }, "owner", "toolLaunchers.signIn", ["jq"]),
	route("cliTools.remove", { name: "jq" }, "owner", ["cliTools.remove", "toolLaunchers.forget"], ["jq"]),
	route("programs.found", undefined, "owner", "settings.current"),
	route("programs.setUp", { program: "no-such-program" }, "owner", undefined, undefined, { ends: "CONFLICT" }),
	route("harnesses.list", undefined, "owner", ["settings.view", "profiles.list"], undefined, { given: { settings: { current: settingsOf } } }),
	route("harnesses.saveCustom", { slug: "goose", label: "Goose", command: "goose" }, "owner", "settings.save", [{ customAgents: [{ slug: "goose", label: "Goose", command: "goose", args: [], env: {} }] }], { given: { settings: { current: settingsOf } } }),
	route("harnesses.add", { harness: "codex" }, "owner", "settings.save", [{ harnesses: ["codex"] }], { given: { settings: { current: settingsOf } } }),
	route("harnesses.remove", { harness: "codex" }, "owner", "settings.save", [{ harnesses: [] }], { given: { settings: { current: settingsOf }, profiles: { list: () => [] } } }),
	route("harnesses.models", { harness: "claude-code" }, "owner", ["checks.models", "settings.current"], ["claude-code", any]),
	route("harnesses.skills", { harness: "claude-code" }, "owner"),
	route("deciders.list", undefined, "owner"),
	route("deciders.modelsAt", { decider: "openjev", address: { baseUrl: "http://127.0.0.1:9", apiKey: "NOT_SAVED" } }, "owner", undefined, undefined, { given: { connections: { secret: async () => null } } }),
	route("ollama.status", undefined, "owner", "ollama.status", []),
	route("ollama.models", undefined, "owner", "ollama.models", []),
	route("ollama.pull", { model: "bge-m3" }, "owner", "ollama.pull", ["bge-m3"]),
	route("profiles.list", undefined, "owner", ["space.flowUse", "profiles.list"]),
	route("profiles.save", agentProfile, "owner", "profiles.save", [like({ name: "fast" }), undefined], { given: { profiles: { byName: () => undefined } } }),
	route("profiles.catalog", { spaceId: SPACE, ...project }, "session", "space.listDevices", ["p1"]),
	route("profiles.remove", { id: "p-1" }, "owner", "profiles.remove", ["p-1"]),
	// Devices, Offers, the owner's sign-in.
	route("offers.list", undefined, "owner", ["offers.list", "offers.spaces"], []),
	route("offers.make", { ...offer, permissionCap: "acceptEdits", sessionCap: 1 }, "owner", "offers.make", [{ ...offer, permissionCap: "acceptEdits", sessionCap: 1 }, PERSON]),
	route("offers.withdraw", offer, "owner", "offers.withdraw", [offer, PERSON]),
	route("devices.list", undefined, "session", "devices.overview", [{ personId: PERSON, owner: true }]),
	route("devices.others", undefined, "owner", "devices.others", [PERSON]),
	route("devices.moveSecret", { deviceId: "laptop", ...secret, to: "personal" }, "owner", "devices.moveSecretOn", ["laptop", "GH_TOKEN", { to: "personal" }]),
	route("devices.space", undefined, "session", "offers.spaceDevices", [SPACE, PERSON]),
	route("devices.review", { userCode: " ABCDEFGH " }, "session", "devices.review", [any, "ABCDEFGH", PERSON]),
	route("devices.approve", { userCode: "ABCDEFGH" }, "session", "devices.approve", [any, "ABCDEFGH"]),
	route("devices.deny", { userCode: "ABCDEFGH" }, "session", "devices.deny", [any, "ABCDEFGH"]),
	route("devices.revoke", { deviceId: "d2" }, "session", "devices.revoke", [PERSON, "d2"]),
	route("devices.forget", { deviceId: "d2" }, "session", "devices.forget", [PERSON, "d2"]),
	route("devices.phones", undefined, "session", ["devices.hostOf", "devices.phonesAt"], [SPACE]),
	route("devices.removePhone", { id: "ph" }, "session", "notifications.targets.remove", [PERSON, "ph"], { given: { devices: { hostOf: async () => null } } }),
	route("devices.merge.pending", undefined, "owner", "devices.mergePending", []),
	route("devices.merge.preview", undefined, "owner", "devices.mergePreview", [{}]),
	route("devices.merge.run", undefined, "owner", "devices.merge", [{}]),
	route("devices.leave", undefined, "owner", "devices.leave", []),
	route("devices.join", { url: "https://studio.example.com", role: "guest" }, "owner", "devices.join", [{ url: "https://studio.example.com", role: "guest" }, any]),
	route("account.status", undefined, "public"),
	route("account.setLogin", { email: "ada@example.com", password: "a-long-password" }, "owner", "setLogin", [PERSON, like({ email: "ada@example.com" })], { given: { fromThisComputer: true } }),
];

/** The procedure at `path` of the router. */
function procedureAt(path: string): AnyProcedure {
	const found = path
		.split(".")
		.reduce<unknown>(
			(node, key) => (node as Record<string, unknown>)[key],
			appRouter,
		);
	if (!isProcedure(found)) throw new Error(`No procedure at ${path}.`);
	return found;
}

/** Every procedure of the router, by its path, the peer protocol left out: `@nightshift/devices` tests it. */
function screenProcedures(
	router: Record<string, unknown>,
	prefix: string[] = [],
): string[] {
	const peer = new Set(Object.keys(hostRouter));
	const peerDevices = new Set(Object.keys(hostRouter.devices));
	return Object.entries(router).flatMap(([key, value]) => {
		const path = [...prefix, key];
		if (prefix.length === 0 && key !== "devices" && peer.has(key)) return [];
		if (
			prefix[0] === "devices" &&
			prefix.length === 1 &&
			peerDevices.has(key)
		) {
			return [];
		}
		return isProcedure(value)
			? [path.join(".")]
			: screenProcedures(value as Record<string, unknown>, path);
	});
}

/** The record a route's `calls` entry names. */
function expected(member: string, args?: unknown[]): Call {
	const record: Call = member.startsWith("space.")
		? { space: SPACE, method: member.slice("space.".length), args: any }
		: { method: member, args: any };
	return args ? { ...record, args } : record;
}

/** Who calls: nobody, a Device, or a Person with a role in the Space who owns this computer or not. */
type Caller =
	| { kind: "signed-out" }
	| { kind: "device-key" }
	| { kind: "person"; role: Role; owner: boolean };

const CALLERS: { name: string; caller: Caller }[] = [
	{ name: "a signed-out request", caller: { kind: "signed-out" } },
	{ name: "a Device key", caller: { kind: "device-key" } },
	{
		name: "a viewer",
		caller: { kind: "person", role: "viewer", owner: false },
	},
	{
		name: "a member",
		caller: { kind: "person", role: "member", owner: false },
	},
	{ name: "the owner", caller: { kind: "person", role: "owner", owner: true } },
];

/** Whether `caller` may call a route that needs `need`. */
function allowed(need: Need, caller: Caller): boolean {
	if (need === "public") return true;
	if (caller.kind !== "person") return false;
	if (need === "session") return true;
	if (need === "owner") return caller.owner;
	if ("owner" in need && need.owner === true) {
		return caller.owner && roleAllows(caller.role, need.role);
	}
	return roleAllows(caller.role, need as Permissions);
}

/** The refusal `caller` gets from a route it may not call. */
function refusalFor(caller: Caller): string {
	return caller.kind === "person" ? "FORBIDDEN" : "UNAUTHORIZED";
}

/** The request of `caller`, over recording services, with the route's own fakes. */
function contextOf(db: Context["db"], caller: Caller, given?: Given): Context {
	const signedOut = {
		...accessAs({ personId: "nobody", spaceId: SPACE, role: "viewer" }),
		session: null,
		spaceId: null,
	};
	if (caller.kind === "signed-out") return recording(db, signedOut, { given });
	if (caller.kind === "device-key") {
		return recording(db, signedOut, {
			given,
			deviceKey: {
				keyId: "k",
				deviceId: "device-b",
				personId: PERSON,
				permissions: { sync: ["pull", "push"] },
			},
		});
	}
	const personId = caller.owner ? OWNER : "bob";
	const access = accessAs({ personId, spaceId: SPACE, role: caller.role });
	const members = recorder(["access", "members"], (method, args) => {
		calls.push({ method, args });
	});
	return recording(
		db,
		{
			...access,
			setActiveSpace: recorder(["access", "setActiveSpace"], (m, a) => {
				calls.push({ method: m, args: a });
			}) as Context["access"]["setActiveSpace"],
			createSpace: recorder(["access", "createSpace"], (m, a) => {
				calls.push({ method: m, args: a });
			}) as Context["access"]["createSpace"],
			members: members as Context["access"]["members"],
		},
		{ given },
	);
}

/** Calls the route and drains a stream it returns, so a streaming body runs. */
async function callRoute(route: Route, context: Context): Promise<unknown> {
	const result = await call(procedureAt(route.path), route.input, { context });
	if (result && typeof result === "object" && Symbol.asyncIterator in result) {
		for await (const _ of result as AsyncIterable<unknown>) {
			// The fake stream has no items.
		}
	}
	return result;
}

// ---------------------------------------------------------------------------

let sandbox: AuthSandbox;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
	calls = [];
	gatesIn = new Map();
	runSpaces = new Map([["r", SPACE]]);
	onResolve = () => {};
});
afterEach(() => sandbox.cleanup());

// The fake services answer anything: these tests check sessions, roles and
// the member each route calls, not replies. contract.test.ts checks the replies.
let quiet: () => void;
beforeAll(() => {
	quiet = onOutputMismatch(() => {});
});
afterAll(() => quiet());

async function errorOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ORPCError) return error.code;
		throw error;
	}
	throw new Error("The call did not fail.");
}

/** The refusal a call ends in: its code, whether the procedure declares it, and its message. */
async function refusalOf(
	promise: Promise<unknown>,
): Promise<{ code: string; defined: boolean; message: string }> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ORPCError) {
			return {
				code: error.code,
				defined: error.defined,
				message: error.message,
			};
		}
		throw error;
	}
	throw new Error("The call did not fail.");
}

describe("every route", () => {
	test("is in the table", () => {
		const listed = new Set(ROUTES.map((route) => route.path));
		expect(screenProcedures(appRouter).filter((p) => !listed.has(p))).toEqual(
			[],
		);
		expect([...listed].filter((p) => !isProcedure(procedureAt(p)))).toEqual([]);
	});

	for (const { name, caller } of CALLERS) {
		test(`lets ${name} call what their permission allows, and refuses the rest`, async () => {
			const refused: string[] = [];
			const passed: string[] = [];
			for (const route of ROUTES) {
				calls = [];
				const context = contextOf(sandbox.db, caller, route.given);
				const outcome = await callRoute(route, context).then(
					() => "ok",
					(error: unknown) =>
						error instanceof ORPCError ? error.code : String(error),
				);
				const may = allowed(route.needs, caller);
				if (!may) {
					refused.push(`${route.path}: ${outcome}`);
					if (outcome !== refusalFor(caller)) {
						throw new Error(
							`${route.path} should refuse ${name} with ${refusalFor(caller)}, ended in ${outcome}.`,
						);
					}
					// A refused call reaches no service beyond the Space of a run.
					expect(
						calls.filter((c) => c.method !== "spaceOfRun"),
						route.path,
					).toEqual([]);
				} else {
					passed.push(`${route.path}: ${outcome}`);
					expect(outcome, route.path).toBe(route.ends ?? "ok");
				}
			}
			// The table is not all one way: a caller is let in somewhere and refused somewhere.
			if (caller.kind === "person") expect(passed.length).toBeGreaterThan(0);
			if (caller.kind !== "person" || !caller.owner) {
				expect(refused.length).toBeGreaterThan(0);
			}
		});
	}

	test("forwards to its member, with the arguments its input gives", async () => {
		const owner: Caller = { kind: "person", role: "owner", owner: true };
		const missed: string[] = [];
		for (const route of ROUTES) {
			if (!route.calls) continue;
			calls = [];
			await callRoute(route, contextOf(sandbox.db, owner, route.given));
			const members = Array.isArray(route.calls) ? route.calls : [route.calls];
			const [first, ...rest] = members;
			if (!first) throw new Error(`${route.path} names no member.`);
			const wanted = [
				expected(first, route.args),
				...rest.map((m) => expected(m)),
			];
			for (const want of wanted) {
				const found = calls.some((made) => {
					try {
						expect(made).toEqual(want);
						return true;
					} catch {
						return false;
					}
				});
				if (!found) {
					missed.push(
						`${route.path}: wanted ${want.method}${want.args === any ? "" : ` ${JSON.stringify(want.args)}`}, made ${JSON.stringify(calls.map((c) => [c.method, c.args]))}`,
					);
				}
			}
		}
		expect(missed).toEqual([]);
	});

	test("the pass-through routes forward one call and nothing else", async () => {
		const owner: Caller = { kind: "person", role: "owner", owner: true };
		const forwarding = ROUTES.filter(
			(route) => typeof route.calls === "string" && route.args && !route.given,
		);
		expect(forwarding.length).toBeGreaterThan(70);
		const extra: string[] = [];
		for (const route of forwarding) {
			calls = [];
			await callRoute(route, contextOf(sandbox.db, owner));
			// The run's Space, then the one call. A project's procedure reads the Space's projects first.
			const made = calls.filter(
				(c) => c.method !== "spaceOfRun" && c.method !== "listProjects",
			);
			if (made.length !== 1) {
				extra.push(`${route.path}: ${made.map((c) => c.method).join(", ")}`);
			}
		}
		expect(extra).toEqual([]);
	});
});

describe("a procedure keyed by a project", () => {
	const owner: Caller = { kind: "person", role: "owner", owner: true };
	const viewer: Caller = { kind: "person", role: "viewer", owner: false };
	const projects = { listProjects: async () => [{ id: "p1" }] };

	test("passes the project of the Space on, and refuses one the Space does not have as not found", async () => {
		const context = contextOf(sandbox.db, owner, { space: projects });
		await call(
			appRouter.projects.setSecret,
			{ projectId: "p1", name: "GH_TOKEN", value: "v" },
			{ context },
		);
		expect(calls.at(-1)).toEqual({
			method: "connections.setProjectSecret",
			args: [{ spaceId: SPACE, projectId: "p1" }, "GH_TOKEN", "v", PERSON],
		});
		expect(
			await refusalOf(
				call(
					appRouter.knowledge.search,
					{ projectId: "p2", query: "x" },
					{ context },
				),
			),
		).toEqual({
			code: "NOT_FOUND",
			defined: false,
			message: PROJECT_NOT_FOUND,
		});
		expect(calls.filter((c) => c.method.startsWith("knowledge."))).toEqual([]);
	});

	test("checks the role before it reads anything", async () => {
		const context = contextOf(sandbox.db, viewer, { space: projects });
		expect(
			await errorOf(
				call(
					appRouter.knowledge.keepLearning,
					{ projectId: "p2", id: "l1" },
					{ context },
				),
			),
		).toBe("FORBIDDEN");
		expect(calls).toEqual([]);
	});

	test("lists the learnings of every project of the Space, or of one it has", async () => {
		const context = contextOf(sandbox.db, owner, { space: projects });
		await call(appRouter.knowledge.learnings, undefined, { context });
		expect(calls.at(-1)).toMatchObject({
			method: "knowledge.learnings",
			args: [["p1"]],
		});
		expect(
			await errorOf(
				call(appRouter.knowledge.learnings, { projectId: "p2" }, { context }),
			),
		).toBe("NOT_FOUND");
	});
});

// ---------------------------------------------------------------------------
// With real sessions: what the table cannot say. A Space of Ada's with Bob as
// member and Cy as viewer; each session is in it.

/**
 * A request from another computer, with these headers (none: signed out),
 * on a Host with `policy`, on a computer `ownerId` owns, with the recording
 * services and the test's own `given`.
 */
async function contextFor(
	headers: Headers | null,
	options: {
		policy?: HostPolicy;
		ownerId?: string;
		given?: Given;
		deviceKey?: Context["deviceKey"];
	} = {},
): Promise<Context> {
	const {
		policy = OPEN_HOST,
		ownerId = "the-owner",
		given,
		deviceKey,
	} = options;
	const access = headers
		? await requestAccess(sandbox.auth, sandbox.db, headers, null, policy)
		: {
				...accessAs({ personId: "nobody", spaceId: SPACE, role: "viewer" }),
				session: null,
				spaceId: null,
			};
	const context = recording(sandbox.db, access, { ownerId, given, deviceKey });
	return { ...context, requireTwoFactor: policy.requireTwoFactor };
}

async function platform() {
	const ada = await sandbox.signUp("Ada");
	const bob = await sandbox.signUp("Bob");
	const cy = await sandbox.signUp("Cy");
	const space = await sandbox.auth.api.createOrganization({
		headers: ada.headers,
		body: { name: "Platform", slug: "platform" },
	});
	if (!space) throw new Error("no space");
	for (const [person, role] of [
		[bob, "member"],
		[cy, "viewer"],
	] as const) {
		await sandbox.auth.api.addMember({
			body: { userId: person.userId, role, organizationId: space.id },
		});
		await sandbox.auth.api.setActiveOrganization({
			headers: person.headers,
			body: { organizationId: space.id },
		});
	}
	return { ada, bob, cy, spaceId: space.id };
}

/** The Space and member of each call of a Space view, in order. */
const seen = () =>
	calls.filter((c) => c.space).map(({ space, method }) => ({ space, method }));

const start = { projectId: "p1", flowName: "night" };

describe("sessions", () => {
	test("a permitted call reads the session and the memberships once, and decides in memory", async () => {
		const { bob, spaceId } = await platform();
		const statements = sandbox.countStatements();
		const member = await contextFor(bob.headers);
		await call(appRouter.runs.start, start, { context: member });
		expect(seen().at(-1)).toEqual({ space: spaceId, method: "startRun" });
		// The run is started by Bob: commits in it are in his name.
		expect(calls.at(-1)?.args).toEqual([{ ...start, startedBy: bob.userId }]);
		// The session and its Person, then the memberships. It was 7.
		expect(statements()).toBe(3);
		// The inbox of every Space: the roles come with the Spaces, not 4
		// statements more per Space.
		await call(appRouter.gates.list, undefined, { context: member });
		expect(statements()).toBe(4);
	});

	test("a session works in its own Space only, never one it is not a member of", async () => {
		const { spaceId } = await platform();
		const dee = await sandbox.signUp("Dee");
		const own = (await personalSpaceId(sandbox.db, dee.userId)) ?? "";
		// A session that names a Space of others.
		await sandbox.db.$client.execute({
			sql: "UPDATE session SET active_organization_id = ? WHERE user_id = ?",
			args: [spaceId, dee.userId],
		});

		const context = await contextFor(dee.headers);
		expect(context.access.spaceId).toBe(own);
		await call(appRouter.runs.list, undefined, { context });
		await call(appRouter.gates.list, undefined, { context });
		expect(seen().map((c) => c.space)).toEqual([own, own]);
	});

	test("a Person lists their Spaces, personal first, and switches between them", async () => {
		const { ada, spaceId } = await platform();
		const dee = await sandbox.signUp("Dee");
		let context = await contextFor(ada.headers);
		const listed = await call(appRouter.spaces.list, undefined, { context });
		expect(listed.spaces.map((s) => [s.name, s.personal, s.role])).toEqual([
			["Personal", true, "owner"],
			["Platform", false, "owner"],
		]);
		expect(listed.active).toBe(spaceId);

		const personal = listed.spaces[0]?.id ?? "";
		await call(appRouter.spaces.switch, { spaceId: personal }, { context });
		context = await contextFor(ada.headers);
		expect(context.access.spaceId).toBe(personal);

		// Not a Space of Dee's.
		const theirs = await contextFor(dee.headers);
		await expect(
			call(appRouter.spaces.switch, { spaceId }, { context: theirs }),
		).rejects.toThrow();
		expect((await contextFor(dee.headers)).access.spaceId).not.toBe(spaceId);
	});

	test("a Person creates a Space, owns it, and works in it", async () => {
		const ada = await sandbox.signUp("Ada");
		let context = await contextFor(ada.headers);
		const { id } = await call(
			appRouter.spaces.create,
			{ name: "  Platform  " },
			{ context },
		);
		context = await contextFor(ada.headers);
		expect(context.access.spaceId).toBe(id);
		const listed = await call(appRouter.spaces.list, undefined, { context });
		expect(listed.spaces.find((s) => s.id === id)).toEqual({
			id,
			name: "Platform",
			personal: false,
			role: "owner",
		});
	});

	test("moving a project needs project.move in both Spaces", async () => {
		const { ada, bob, spaceId } = await platform();
		const move = { projectId: "p1", spaceId };

		// Ada owns her personal Space and Platform: she may.
		const personal = (await personalSpaceId(sandbox.db, ada.userId)) ?? "";
		const owner = await contextFor(ada.headers);
		await call(
			appRouter.spaces.switch,
			{ spaceId: personal },
			{ context: owner },
		);
		await call(appRouter.projects.move, move, {
			context: await contextFor(ada.headers),
		});
		expect(seen().at(-1)).toEqual({ space: personal, method: "moveProject" });

		// Bob is only a member of Platform: moving into it from his own Space is refused.
		const bobsOwn = (await personalSpaceId(sandbox.db, bob.userId)) ?? "";
		const member = await contextFor(bob.headers);
		await call(
			appRouter.spaces.switch,
			{ spaceId: bobsOwn },
			{ context: member },
		);
		expect(
			await errorOf(
				call(appRouter.projects.move, move, {
					context: await contextFor(bob.headers),
				}),
			),
		).toBe("FORBIDDEN");
		// And out of Platform too: a member may not move.
		await call(appRouter.spaces.switch, { spaceId }, { context: member });
		expect(
			await errorOf(
				call(
					appRouter.projects.move,
					{ projectId: "p1", spaceId: bobsOwn },
					{ context: await contextFor(bob.headers) },
				),
			),
		).toBe("FORBIDDEN");
		expect(seen().filter((c) => c.method === "moveProject")).toHaveLength(1);
	});
});

describe("Members", () => {
	test("a personal Space takes no invitations", async () => {
		const ada = await sandbox.signUp("Ada");
		const context = await contextFor(ada.headers);
		const listed = await call(appRouter.members.list, undefined, { context });
		expect(listed.space).toMatchObject({ personal: true, role: "owner" });
		expect(listed.members.map((m) => m.name)).toEqual(["Ada"]);
		await expect(
			call(
				appRouter.members.invite,
				{ email: "carol@example.com", role: "member" },
				{ context },
			),
		).rejects.toThrow("Nobody can join a personal Space");
	});

	test("invite, open the link, sign up, accept: a Member who works in the Space", async () => {
		const { ada, spaceId } = await platform();
		const owner = await contextFor(ada.headers);
		const { id } = await call(
			appRouter.members.invite,
			{ email: "Carol@Example.com", role: "member" },
			{ context: owner },
		);
		const listed = await call(appRouter.members.list, undefined, {
			context: owner,
		});
		expect(listed.can).toEqual({
			invite: true,
			remove: true,
			changeRole: true,
		});
		expect(listed.invitations.map((i) => [i.email, i.role])).toEqual([
			["carol@example.com", "member"],
		]);

		// The link's page, before anyone signs in.
		const anonymous = await contextFor(null);
		expect(
			await call(
				appRouter.invitations.get,
				{ invitationId: id },
				{ context: anonymous },
			),
		).toMatchObject({
			spaceName: "Platform",
			email: "carol@example.com",
			status: "pending",
			hasAccount: false,
		});
		expect(
			await errorOf(
				call(
					appRouter.invitations.get,
					{ invitationId: "nope" },
					{ context: anonymous },
				),
			),
		).toBe("NOT_FOUND");

		const signedUp = await sandbox.auth.api.signUpEmail({
			body: {
				name: "Carol",
				email: "carol@example.com",
				password: "a-long-password",
				invitationId: id,
			} as { name: string; email: string; password: string },
			asResponse: true,
		});
		const carol = new Headers({
			cookie: signedUp.headers
				.getSetCookie()
				.map((c) => c.split(";")[0])
				.join("; "),
		});
		expect(
			await call(
				appRouter.invitations.accept,
				{ invitationId: id },
				{ context: await contextFor(carol) },
			),
		).toEqual({ spaceId });
		const joined = await contextFor(carol);
		expect(joined.access.spaceId).toBe(spaceId);
		const after = await call(appRouter.members.list, undefined, {
			context: joined,
		});
		expect(after.members.map((m) => [m.name, m.role])).toEqual([
			["Ada", "owner"],
			["Bob", "member"],
			["Cy", "viewer"],
			["Carol", "member"],
		]);
		expect(after.can).toEqual({
			invite: false,
			remove: false,
			changeRole: false,
		});
	});

	test("an owner changes a role and removes a Member, who then loses the Space", async () => {
		const { ada, bob, spaceId } = await platform();
		const owner = await contextFor(ada.headers);
		const listed = await call(appRouter.members.list, undefined, {
			context: owner,
		});
		const membership = listed.members.find((m) => m.name === "Bob");
		await call(
			appRouter.members.setRole,
			{ memberId: membership?.id ?? "", role: "viewer" },
			{ context: owner },
		);
		const bobs = await contextFor(bob.headers);
		expect(
			await errorOf(call(appRouter.runs.start, start, { context: bobs })),
		).toBe("FORBIDDEN");

		await call(
			appRouter.members.remove,
			{ memberId: membership?.id ?? "" },
			{ context: owner },
		);
		const removed = await contextFor(bob.headers);
		expect(removed.access.spaceId).not.toBe(spaceId);
		await call(appRouter.runs.list, undefined, { context: removed });
		expect(seen().at(-1)?.space).toBe(removed.access.spaceId ?? "");
	});
});

describe("a Host that requires two-factor sign-in", () => {
	const REQUIRED = { requireTwoFactor: true };

	test("a session without it may only read how it signs in, until it turns two-factor on", async () => {
		const ada = await sandbox.signUp("Ada");
		const refused = await contextFor(ada.headers, { policy: REQUIRED });
		for (const procedure of [
			call(appRouter.runs.list, undefined, { context: refused }),
			call(appRouter.spaces.list, undefined, { context: refused }),
			call(
				appRouter.invitations.accept,
				{ invitationId: "x" },
				{
					context: refused,
				},
			),
			call(appRouter.settings.get, undefined, { context: refused }),
		]) {
			expect(await errorOf(procedure)).toBe(TWO_FACTOR_REQUIRED);
		}
		expect(calls).toEqual([]);
		expect(
			await call(appRouter.account.status, undefined, { context: refused }),
		).toEqual({
			signedIn: true,
			person: { name: "Ada", email: "ada@example.com" },
			thisComputer: false,
			hasPassword: true,
			// How long a trusted browser skips the code: the rule of auth, not a copy.
			twoFactor: {
				enabled: false,
				required: true,
				setUpNeeded: true,
				trustedBrowserDays: TRUSTED_BROWSER_DAYS,
			},
		});
		expect(
			await call(appRouter.healthCheck, undefined, { context: refused }),
		).toBe("OK");

		const { headers } = await turnOnTwoFactor(sandbox.auth, ada.headers);
		const allowed = await contextFor(headers, { policy: REQUIRED });
		expect(
			await call(appRouter.runs.list, undefined, { context: allowed }),
		).toEqual([]);
		expect(
			await call(appRouter.account.status, undefined, { context: allowed }),
		).toMatchObject({
			twoFactor: { enabled: true, required: true, setUpNeeded: false },
		});
	});

	test("a Device key is not affected", async () => {
		const context = await contextFor(null, {
			policy: REQUIRED,
			given: {
				devices: {
					admit: async () => ({
						keyId: "k",
						deviceId: "device-b",
						personId: "ada",
						permissions: { sync: ["pull"] },
						device: { name: "B", homeHost: null },
						spaces: async () => [],
						roleIn: async () => null,
						member: async () => false,
						may: async () => {},
					}),
					hello: async () => ({
						host: { id: "host", name: "Host", addresses: [] },
						deviceId: "device-b",
						personId: "ada",
						spaces: [],
					}),
				},
			},
			deviceKey: {
				keyId: "k",
				deviceId: "device-b",
				personId: "ada",
				permissions: { sync: ["pull"] },
			},
		});
		expect(
			await call(appRouter.link.hello, undefined, { context }),
		).toMatchObject({ deviceId: "device-b" });
	});

	test("without a session, status says so", async () => {
		expect(
			await call(appRouter.account.status, undefined, {
				context: await contextFor(null, { policy: REQUIRED }),
			}),
		).toMatchObject({ signedIn: false, twoFactor: { required: true } });
	});
});

describe("a streaming procedure", () => {
	/** The error `devices.join` ends in after its code, when the join throws `thrown`. */
	async function joinEndsIn(
		thrown: Error,
	): Promise<ORPCError<string, unknown>> {
		const ada = await sandbox.signUp("Ada");
		const context = await contextFor(ada.headers, {
			ownerId: ada.userId,
			given: {
				devices: {
					async *join() {
						yield {
							kind: "code" as const,
							userCode: "ABCDEFGH",
							verificationUri: "https://studio.example.com/devices",
							verificationUriComplete:
								"https://studio.example.com/devices?pair=ABCDEFGH",
							fingerprint: null,
							expiresAt: 0,
						};
						throw thrown;
					},
				},
			},
		});
		const progress = await call(
			appRouter.devices.join,
			{ url: "https://studio.example.com", role: "guest" },
			{ context, path: ["devices", "join"] },
		);
		const seenKinds: string[] = [];
		try {
			for await (const step of progress) seenKinds.push(step.kind);
		} catch (error) {
			expect(seenKinds).toEqual(["code"]);
			expect(error).toBeInstanceOf(ORPCError);
			return error as ORPCError<string, unknown>;
		}
		throw new Error("The stream did not fail.");
	}

	test("passes a refusal on with its words, as it does for a plain call", async () => {
		const error = await joinEndsIn(
			new Refusal("forbidden", "The pairing was declined on the Host."),
		);
		expect(error.code).toBe("FORBIDDEN");
		expect(error.message).toBe("The pairing was declined on the Host.");
	});

	test("ends a failure in plain words, and logs it with the procedure", async () => {
		const failure = new Error("ECONNRESET: socket hang up at 10.0.0.7:443");
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const error = await joinEndsIn(failure);
			expect(error.code).toBe("INTERNAL_SERVER_ERROR");
			expect(error.message).toBe(FAILURE_MESSAGE);
			expect(logged).toHaveBeenCalledWith(
				"[api] devices.join failed:",
				failure,
			);
		} finally {
			logged.mockRestore();
		}
	});

	test("gives the body a signal that ends when the client goes away, or when the stream ends", async () => {
		const ada = await sandbox.signUp("Ada");
		const signals: AbortSignal[] = [];
		const context = await contextFor(ada.headers, {
			ownerId: ada.userId,
			given: {
				devices: {
					async *join(_: unknown, signal: AbortSignal) {
						signals.push(signal);
						yield {
							kind: "code" as const,
							userCode: "ABCDEFGH",
							verificationUri: "https://studio.example.com/devices",
							verificationUriComplete:
								"https://studio.example.com/devices?pair=ABCDEFGH",
							fingerprint: null,
							expiresAt: 0,
						};
					},
				},
			},
		});
		const input = { url: "https://studio.example.com", role: "guest" as const };
		// The stream ends: its signal ends with it.
		const ended = await call(appRouter.devices.join, input, { context });
		for await (const _ of ended) {
			// One item.
		}
		expect(signals[0]?.aborted).toBe(true);
		// The client goes away: the signal ends before the stream does.
		const client = new AbortController();
		const left = await call(appRouter.devices.join, input, {
			context,
			signal: client.signal,
		});
		const first = await left[Symbol.asyncIterator]().next();
		expect(first.done).toBe(false);
		expect(signals[1]?.aborted).toBe(false);
		client.abort();
		expect(signals[1]?.aborted).toBe(true);
	});
});

describe("the owner's own sign-in", () => {
	test("is set on this computer only", async () => {
		const ada = await sandbox.signUp("Ada");
		const context = (fromThisComputer: boolean) =>
			contextFor(ada.headers, {
				fromThisComputer,
				ownerId: ada.userId,
			} as never);
		const input = { email: "ada@example.com", password: "a-long-password" };
		expect(
			await errorOf(
				call(appRouter.account.setLogin, input, {
					context: {
						...(await context(false)),
						setLogin: async () => ({ email: input.email }),
					},
				}),
			),
		).toBe("FORBIDDEN");
		const set: string[] = [];
		await call(appRouter.account.setLogin, input, {
			context: {
				...(await contextFor(ada.headers, { ownerId: ada.userId })),
				fromThisComputer: true,
				setLogin: async (personId) => {
					set.push(personId);
					return { email: input.email };
				},
			},
		});
		expect(set).toEqual([ada.userId]);
	});
});

describe("a run opened by its id", () => {
	/** Platform's run, and Bob, Cy and Dee each in their personal Space. */
	async function aRunOfPlatform() {
		const people = await platform();
		const dee = await sandbox.signUp("Dee");
		for (const person of [people.bob, people.cy]) {
			const own = (await personalSpaceId(sandbox.db, person.userId)) ?? "";
			await sandbox.auth.api.setActiveOrganization({
				headers: person.headers,
				body: { organizationId: own },
			});
		}
		runSpaces.set("platform-run", people.spaceId);
		return { ...people, dee };
	}

	/** Reads the run, follows it to its end and stops it: one call each. */
	async function readFollowStop(context: Context, runId: string) {
		await call(appRouter.runs.get, { runId }, { context });
		const followed = await call(appRouter.runs.watch, { runId }, { context });
		for await (const _ of followed) {
			// The fake run has no items.
		}
		await call(appRouter.runs.stop, { runId, when: "now" }, { context });
	}

	test("reads, follows and stops a run of another of the Person's Spaces, without a switch", async () => {
		const { bob, spaceId } = await aRunOfPlatform();
		const context = await contextFor(bob.headers);
		const own = context.access.spaceId ?? "";
		expect(own).not.toBe(spaceId);

		await readFollowStop(context, "platform-run");
		// "Move to…" lists the Devices as the run's own Space sees them.
		await call(
			appRouter.runs.moveTargets,
			{ runId: "platform-run" },
			{ context },
		);
		expect(seen()).toEqual([
			{ space: spaceId, method: "getRun" },
			{ space: spaceId, method: "watchRun" },
			{ space: spaceId, method: "act.stop" },
			{ space: spaceId, method: "listMoveTargets" },
		]);
		// The session still works in its own Space, and lists stay there.
		expect((await contextFor(bob.headers)).access.spaceId).toBe(own);
		await call(appRouter.runs.list, undefined, { context });
		expect(seen().at(-1)).toEqual({ space: own, method: "listRuns" });
	});

	test("finds the Person's role in the run's Space in the memberships the request read", async () => {
		const { bob } = await aRunOfPlatform();
		const context = await contextFor(bob.headers);
		const statements = sandbox.countStatements();
		await readFollowStop(context, "platform-run");
		// The fake engine reads nothing: no statement for the role either.
		expect(statements()).toBe(0);
	});

	test("is not found outside the Person's Spaces, the same as a run that does not exist", async () => {
		const { dee } = await aRunOfPlatform();
		const outsider = await contextFor(dee.headers);
		const notFound = {
			code: "NOT_FOUND",
			defined: true,
			message: "This run is not in one of your Spaces.",
		};
		for (const runId of ["platform-run", "no-such-run"]) {
			const { runs } = appRouter;
			expect(
				await refusalOf(call(runs.get, { runId }, { context: outsider })),
			).toEqual(notFound);
			expect(
				await refusalOf(call(runs.watch, { runId }, { context: outsider })),
			).toEqual(notFound);
			expect(
				await refusalOf(call(runs.stop, { runId }, { context: outsider })),
			).toEqual(notFound);
		}
		expect(seen()).toEqual([]);
	});

	test("acts only as far as the Person's role in the run's Space allows", async () => {
		const { cy, spaceId } = await aRunOfPlatform();
		const viewer = await contextFor(cy.headers);
		await call(
			appRouter.runs.get,
			{ runId: "platform-run" },
			{ context: viewer },
		);
		expect(
			await refusalOf(
				call(
					appRouter.runs.stop,
					{ runId: "platform-run" },
					{ context: viewer },
				),
			),
		).toEqual({
			code: "FORBIDDEN",
			defined: true,
			message: "Your role in this Space does not allow this.",
		});
		expect(seen()).toEqual([{ space: spaceId, method: "getRun" }]);
	});

	test("outside a procedure (a run's file), refuses with the same code, status and words", async () => {
		const { bob, cy, dee, spaceId } = await aRunOfPlatform();
		/** The run's export for a request with these headers, on a Host with `policy`. */
		const exportFor = async (headers: Headers | null, policy = OPEN_HOST) => {
			const context = await contextFor(headers, { policy });
			return runAccess(
				{ access: context.access, engine: context.engine },
				"platform-run",
				{ run: ["export"] },
			);
		};
		// The words of a procedure's refusal in the same case.
		const procedureSays = async (headers: Headers) =>
			(
				await refusalOf(
					call(
						appRouter.runs.stop,
						{ runId: "platform-run" },
						{ context: await contextFor(headers) },
					),
				)
			).message;

		expect(await exportFor(null)).toEqual({
			allowed: false,
			code: "UNAUTHORIZED",
			status: 401,
			message: "Sign in to use Night Shift.",
		});
		expect(
			await exportFor(bob.headers, { requireTwoFactor: true }),
		).toMatchObject({ allowed: false, code: TWO_FACTOR_REQUIRED, status: 403 });
		expect(await exportFor(dee.headers)).toEqual({
			allowed: false,
			code: "NOT_FOUND",
			status: 404,
			message: await procedureSays(dee.headers),
		});
		expect(await exportFor(cy.headers)).toEqual({
			allowed: false,
			code: "FORBIDDEN",
			status: 403,
			message: await procedureSays(cy.headers),
		});
		expect(await exportFor(bob.headers)).toMatchObject({
			allowed: true,
			spaceId,
		});
	});
});

/** An open Gate of a run in a Space, opened at `openedAt`. */
function openGate(spaceId: string, runId: string, openedAt: number): OpenGate {
	return {
		spaceId,
		runId,
		runTitle: `Run ${runId}`,
		flowName: null,
		projectId: `project-${runId}`,
		projectName: "Project",
		stepId: `step-${runId}`,
		nodeId: "ship",
		question: "Ship it?",
		choices: [{ name: "yes" }, { name: "no" }],
		urgency: "today",
		brief: {
			urgencyBy: "default",
			situation: null,
			background: [],
			recommendation: null,
			byModel: [],
		},
		openedAt,
		walker: { id: "device", name: "test", thisDevice: true },
		answerPending: false,
		branchesWork: false,
		lockScreen: false,
		deadline: null,
		form: null,
	};
}

describe("the Needs-you inbox", () => {
	// The inbox rule (which Spaces, the order, who may answer) is the
	// engine's `inboxOf`, tested there. This is the session's Person.
	test("lists the inbox of the session's Person, not only their active Space", async () => {
		const { ada, spaceId } = await platform();
		const personal = (await personalSpaceId(sandbox.db, ada.userId)) ?? "";
		gatesIn.set(spaceId, [openGate(spaceId, "platform-run", 20)]);
		gatesIn.set(personal, [openGate(personal, "ada-run", 10)]);

		// Ada works in Platform; her inbox has her personal Space's Gate too.
		const context = await contextFor(ada.headers);
		expect(context.access.spaceId).toBe(spaceId);
		const listed = await call(appRouter.gates.list, undefined, { context });
		expect(
			listed.map((g) => [g.runId, g.spaceId, g.spaceName, g.canAnswer]),
		).toEqual([
			["ada-run", personal, "Personal", true],
			["platform-run", spaceId, "Platform", true],
		]);
	});

	test("answers a Gate in another of the Person's Spaces without a switch", async () => {
		const { ada, spaceId } = await platform();
		const personal = (await personalSpaceId(sandbox.db, ada.userId)) ?? "";
		runSpaces.set("ada-run", personal);
		const context = await contextFor(ada.headers);
		expect(context.access.spaceId).toBe(spaceId);

		const answer = { runId: "ada-run", stepId: "step-1", choice: "yes" };
		await call(appRouter.gates.resolve, answer, { context });
		expect(seen()).toEqual([{ space: personal, method: "act.answer" }]);
		// Bound to its run and step.
		expect(calls.at(-1)?.args).toEqual([
			"ada-run",
			{ kind: "answer", stepId: "step-1", choice: "yes", via: "_OTHER" },
		]);
		// The session still works in Platform.
		expect((await contextFor(ada.headers)).access.spaceId).toBe(spaceId);
	});

	test("refuses an answer outside the Person's Spaces, or that their role does not allow", async () => {
		const { cy, spaceId } = await platform();
		const dee = await sandbox.signUp("Dee");
		runSpaces.set("platform-run", spaceId);
		const answer = { runId: "platform-run", stepId: "s", choice: "yes" };

		// Not a member: the same answer as a run that does not exist.
		const outsider = await contextFor(dee.headers);
		expect(
			await errorOf(
				call(appRouter.gates.resolve, answer, { context: outsider }),
			),
		).toBe("NOT_FOUND");
		expect(
			await errorOf(
				call(
					appRouter.gates.resolve,
					{ ...answer, runId: "no-such-run" },
					{ context: outsider },
				),
			),
		).toBe("NOT_FOUND");

		// A viewer of the Space.
		const viewer = await contextFor(cy.headers);
		expect(
			await errorOf(call(appRouter.gates.resolve, answer, { context: viewer })),
		).toBe("FORBIDDEN");
		expect(seen()).toEqual([]);
	});

	test("takes an answer from the lock screen only for a Gate its author marked for it", async () => {
		const { bob, spaceId } = await platform();
		runSpaces.set("marked-run", spaceId);
		runSpaces.set("plain-run", spaceId);
		gatesIn.set(spaceId, [
			{ ...openGate(spaceId, "marked-run", 1), lockScreen: true },
			openGate(spaceId, "plain-run", 2),
		]);
		const context = await contextFor(bob.headers);
		const fromLockScreen = (runId: string) => ({
			runId,
			stepId: `step-${runId}`,
			choice: "yes",
			via: "lock-screen" as const,
		});

		await call(appRouter.gates.resolve, fromLockScreen("marked-run"), {
			context,
		});
		expect(calls.at(-1)?.args).toEqual([
			"marked-run",
			{
				kind: "answer",
				stepId: "step-marked-run",
				choice: "yes",
				via: "lock_screen",
			},
		]);

		expect(
			await refusalOf(
				call(appRouter.gates.resolve, fromLockScreen("plain-run"), {
					context,
				}),
			),
		).toEqual({
			code: "NEEDS_APP",
			defined: true,
			message: "Open this Gate in Night Shift to answer it.",
		});
		// A Gate that is no longer open is closed. Which answers the lock
		// screen takes is the engine's `lockScreenRefusal`, tested there.
		runSpaces.set("closed-run", spaceId);
		expect(
			await refusalOf(
				call(appRouter.gates.resolve, fromLockScreen("closed-run"), {
					context,
				}),
			),
		).toEqual({
			code: "GATE_CLOSED",
			defined: true,
			message: "This Gate does not wait anymore.",
		});
		expect(
			seen()
				.filter((c) => c.method === "act.answer")
				.map((c) => c.space),
		).toEqual([spaceId]);

		// From the app, the same Gate takes the answer.
		const { via: _via, ...inApp } = fromLockScreen("plain-run");
		await call(appRouter.gates.resolve, inApp, { context });
		expect(calls.at(-1)?.args).toEqual([
			"plain-run",
			{
				kind: "answer",
				stepId: "step-plain-run",
				choice: "yes",
				via: "_OTHER",
			},
		]);
	});

	test("refuses an answer once the Gate is closed, without the step's id", async () => {
		const { bob, spaceId } = await platform();
		runSpaces.set("platform-run", spaceId);
		onResolve = () => {
			throw new GateClosedError("Step s is not the open Gate of this run.");
		};
		const context = await contextFor(bob.headers);
		expect(
			await refusalOf(
				call(
					appRouter.gates.resolve,
					{ runId: "platform-run", stepId: "s", choice: "yes" },
					{ context },
				),
			),
		).toEqual({
			code: "GATE_CLOSED",
			defined: true,
			message: "This Gate does not wait anymore.",
		});
	});

	test("another refusal is the status of its kind, with its words", async () => {
		const { bob, spaceId } = await platform();
		runSpaces.set("platform-run", spaceId);
		onResolve = () => {
			throw new Refusal("conflict", "The run cap is reached: 2 runs at once.");
		};
		const context = await contextFor(bob.headers);
		expect(
			await refusalOf(
				call(
					appRouter.gates.resolve,
					{ runId: "platform-run", stepId: "s", choice: "yes" },
					{ context },
				),
			),
		).toEqual({
			code: "CONFLICT",
			defined: false,
			message: "The run cap is reached: 2 runs at once.",
		});
	});

	test("a failure is a 500 in plain words, and its details go to the log", async () => {
		const { bob, spaceId } = await platform();
		runSpaces.set("platform-run", spaceId);
		const failure = new Error(
			"git worktree add failed: fatal: '/Users/bob/work' is already checked out (exit code 128)",
		);
		onResolve = () => {
			throw failure;
		};
		const context = await contextFor(bob.headers);
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const error = await call(
				appRouter.gates.resolve,
				{ runId: "platform-run", stepId: "s", choice: "yes" },
				{ context, path: ["gates", "resolve"] },
			).then(
				() => new Error("The call did not fail."),
				(e: unknown) => e as Error,
			);
			expect(error).toBeInstanceOf(ORPCError);
			expect(error).toMatchObject({
				code: "INTERNAL_SERVER_ERROR",
				status: 500,
				defined: false,
				message: FAILURE_MESSAGE,
			});
			expect(error.message).not.toContain("fatal");
			expect(logged).toHaveBeenCalledWith(
				"[api] gates.resolve failed:",
				failure,
			);
		} finally {
			logged.mockRestore();
		}
	});

	test("a bug in the code is a failure too", async () => {
		const { bob, spaceId } = await platform();
		runSpaces.set("platform-run", spaceId);
		onResolve = () => {
			(null as unknown as { gate: string }).gate;
		};
		const context = await contextFor(bob.headers);
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(
				await refusalOf(
					call(
						appRouter.gates.resolve,
						{ runId: "platform-run", stepId: "s", choice: "yes" },
						{ context },
					),
				),
			).toEqual({
				code: "INTERNAL_SERVER_ERROR",
				defined: false,
				message: FAILURE_MESSAGE,
			});
			expect(logged.mock.calls[0]?.[1]).toBeInstanceOf(TypeError);
		} finally {
			logged.mockRestore();
		}
	});

	test("an answer the Host of the Space cannot take now has its own code", async () => {
		const { bob, spaceId } = await platform();
		runSpaces.set("platform-run", spaceId);
		onResolve = () => {
			throw new HostUnreachableError();
		};
		const context = await contextFor(bob.headers);
		expect(
			await refusalOf(
				call(
					appRouter.gates.resolve,
					{ runId: "platform-run", stepId: "s", choice: "yes" },
					{ context },
				),
			),
		).toEqual({
			code: "HOST_UNREACHABLE",
			defined: false,
			message: HOST_UNREACHABLE,
		});
	});

	test("each refusal of an answer is declared", async () => {
		const { cy, spaceId } = await platform();
		const dee = await sandbox.signUp("Dee");
		runSpaces.set("platform-run", spaceId);
		const answer = { runId: "platform-run", stepId: "s", choice: "yes" };
		for (const [headers, code] of [
			[dee.headers, "NOT_FOUND"],
			[cy.headers, "FORBIDDEN"],
		] as const) {
			const refusal = await refusalOf(
				call(appRouter.gates.resolve, answer, {
					context: await contextFor(headers),
				}),
			);
			expect([refusal.code, refusal.defined]).toEqual([code, true]);
		}
	});
});

describe("the error rule at the API seam", () => {
	test("gives each kind of refusal its status, with its words", () => {
		const expected: Record<RefusalKind, { code: string; status: number }> = {
			invalid: { code: "BAD_REQUEST", status: 400 },
			"signed-out": { code: "UNAUTHORIZED", status: 401 },
			forbidden: { code: "FORBIDDEN", status: 403 },
			"not-found": { code: "NOT_FOUND", status: 404 },
			conflict: { code: "CONFLICT", status: 409 },
			unavailable: { code: "SERVICE_UNAVAILABLE", status: 503 },
		};
		for (const [kind, answer] of Object.entries(expected)) {
			const refusal = new Refusal(kind as RefusalKind, "Words for people.");
			expect(readable(refusal, ["runs", "start"])).toMatchObject({
				...answer,
				message: "Words for people.",
			});
		}
	});

	test("passes an oRPC error on as it is, a declared one too", () => {
		const declared = new ORPCError("GATE_CLOSED", {
			status: 409,
			message: "This Gate does not wait anymore.",
		});
		expect(readable(declared, ["gates", "resolve"])).toBe(declared);
	});
});
