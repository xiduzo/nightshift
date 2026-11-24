import { describe, expect, test } from "bun:test";
import type { EngineEventType, EnginePayloads } from "./events";
import { PERSON_FIELDS, personFieldTypes } from "./person-fields";

/** The Person of every sample. */
const LOCAL = "ada";

const usage = { inputTokens: 1, outputTokens: 2 };
const item = { id: "i1", title: "Item", url: null, value: 1 };

/**
 * One payload of every event type, with `LOCAL` in each field that names
 * a Person and nowhere else. A new event type needs a sample here too.
 */
const samples: { [T in EngineEventType]: EnginePayloads[T] } = {
	ProjectAdded: {
		projectId: "p1",
		name: "app",
		repoPath: "/app",
		remote: null,
	},
	ProjectRemoved: { projectId: "p1" },
	ProjectRestored: { projectId: "p1" },
	CloneAdded: { projectId: "p1", deviceId: "d1", path: "/app" },
	DeviceJoined: {
		deviceId: "d1",
		name: "laptop",
		platform: "darwin",
		ownerId: LOCAL,
		home: true,
	},
	DeviceRevoked: { deviceId: "d1" },
	DeviceOnline: { deviceId: "d1" },
	DeviceOffline: { deviceId: "d1" },
	MemberJoined: {
		personId: LOCAL,
		role: "owner",
		by: LOCAL,
		invitedBy: LOCAL,
	},
	MemberRemoved: { personId: LOCAL, by: LOCAL },
	MemberRoleChanged: {
		personId: LOCAL,
		role: "admin",
		previousRole: "member",
		by: LOCAL,
	},
	OfferMade: {
		deviceId: "d1",
		deviceName: "laptop",
		profile: "pr1",
		profileName: "Claude",
		permissionCap: "edit",
		sessionCap: 1,
		by: LOCAL,
	},
	OfferWithdrawn: { deviceId: "d1", profile: "pr1", by: LOCAL },
	ProjectRenamed: { projectId: "p1", name: "app" },
	ProjectMoved: { projectId: "p1", from: "s1", to: "s2" },
	RunStarted: {
		projectId: "p1",
		flowName: "triage",
		title: "Triage",
		start: "n1",
		trigger: { kind: "manual" },
		startedBy: LOCAL,
	},
	WorktreeCreated: { worktreePath: "/wt", branch: "b", baseRef: "main" },
	WorktreeRemoved: {
		projectId: "p1",
		runId: "r1",
		worktreePath: null,
		branches: [],
		by: "person",
	},
	StepMoved: { from: "device-a", to: "device-b" },
	HandedOff: {
		from: "d1",
		to: "d2",
		commit: "abc",
		branch: "b",
		worktreePath: "/wt",
	},
	WalkerMoved: { from: "d1", to: "d2", by: LOCAL },
	WalkerArrived: { from: "d1" },
	RunResumed: { nodeId: "n1", stepId: null, prompt: null, by: "person" },
	StepStarted: {
		nodeId: "n1",
		nodeType: "agent",
		visit: 1,
		transcriptPath: "/t",
		logPath: null,
	},
	StepReopened: { prompt: null },
	StepEnded: { outcome: "pass", outputs: {}, error: null },
	VariablesSet: { values: {}, scope: null },
	GateOpened: { question: "Go?", choices: [{ name: "yes" }] },
	SessionStarted: { prompt: "Go", resumeSessionId: null },
	HarnessSessionAssigned: { harnessSessionId: "h1", model: null },
	SessionUsage: { usage, costUsd: null },
	SessionEnded: {
		outcome: "finished",
		error: null,
		errorKind: null,
		usage,
		costUsd: null,
		resetAt: null,
	},
	EdgeTaken: { edgeId: "e1", from: "n1", to: "n2", outcome: "pass" },
	FlowCalled: { flow: "sub", inputs: {} },
	ItemsRead: { count: 1, open: 1 },
	ItemStarted: { item, index: 1, branch: null, baseBranch: null },
	ItemBlocked: { item, blocker: "i0", reason: "failed" },
	ItemEnded: { itemId: "i1", state: "done", reason: null },
	WaitStarted: {
		reason: "device-offline",
		until: null,
		message: "Waits",
		since: 1,
		deviceId: "d2",
		deviceName: "studio",
	},
	LeaseTaken: { name: "stack", nodeId: "own", ttlMinutes: 30, scope: null },
	LeaseReleased: { name: "stack", why: "scope" },
	ServiceStarted: {
		nodeId: "stack",
		scope: null,
		deviceId: "device",
		cwd: "/work",
		logPath: "/logs/stack.log",
		pid: 42,
		startedAt: null,
		spec: {
			start: "docker compose up -d",
			ready: { url: "http://127.0.0.1:8080" },
			everySeconds: 2,
			timeoutMinutes: 5,
			stop: "docker compose down",
			env: {},
		},
	},
	ServiceStopped: { nodeId: "stack", scope: null, why: "scope" },
	WaitEnded: { early: false },
	StopRequested: { by: "person" },
	StopAfterStepRequested: {},
	StopAfterStepCancelled: {},
	RunTakenOver: { by: LOCAL, harness: "claude-code" },
	RunEnded: { status: "finished", reason: null },
	RunWarned: { kind: "cost-unknown", message: "Unknown cost" },
	PullRequestOpened: { url: "https://github.com/acme/app/pull/1" },
	Scored: { score: "gate_decision", value: 1, label: "approve", by: "person" },
	ScheduleFired: {
		projectId: "p1",
		scheduleId: "nightly",
		at: 1,
		runId: "r1",
		error: null,
	},
	ScheduleSkipped: {
		projectId: "p1",
		scheduleId: "nightly",
		at: 1,
		reason: "overlap",
		runId: null,
	},
	WebhookReceived: {
		projectId: "p1",
		scheduleId: "hook",
		at: 1,
		result: "accepted",
		runId: null,
		woke: 0,
		error: null,
	},
	KnowledgeSearched: {
		projectId: "p1",
		query: "deploy",
		hits: [
			{
				path: "wiki/deploy.md",
				section: "Deploy",
				line: 1,
				page: null,
				found: ["words"],
			},
		],
		via: "step",
	},
	KnowledgeRead: {
		projectId: "p1",
		path: "wiki/deploy.md",
		found: true,
		via: "mcp",
	},
};

describe("person fields", () => {
	for (const type of Object.keys(samples) as EngineEventType[]) {
		test(`${type}: the fields that hold a Person are the listed ones`, () => {
			const named = Object.entries(samples[type])
				.filter(([, value]) => value === LOCAL)
				.map(([field]) => field);
			const listed: string[] = [...PERSON_FIELDS[type]];
			expect(named.sort()).toEqual(listed.sort());
		});
	}

	test("each field names the event types that have it", () => {
		const fields = personFieldTypes();
		expect(fields.get("startedBy")).toEqual(["RunStarted"]);
		expect(fields.get("ownerId")).toEqual(["DeviceJoined"]);
		expect(fields.get("by")).toEqual([
			"MemberJoined",
			"MemberRemoved",
			"MemberRoleChanged",
			"OfferMade",
			"OfferWithdrawn",
			"WalkerMoved",
			"RunTakenOver",
		]);
		expect([...fields.keys()].sort()).toEqual([
			"by",
			"invitedBy",
			"ownerId",
			"personId",
			"startedBy",
		]);
	});
});
