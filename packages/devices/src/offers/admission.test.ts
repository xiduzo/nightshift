import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { clone, hostLink, project, user } from "@nightshift/db/schema";
import {
	createSpaceDocuments,
	type Device,
	type PlacedRun,
	type SessionInput,
	type SpaceDocuments,
	worktreeLocation,
} from "@nightshift/engine";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import type { WorkReply, WorkRequest } from "../contract";
import { createHostSpaces } from "../links";
import { deviceDirectory } from "../peers";
import { serveWork } from "../work";
import {
	createOfferAdmission,
	NO_STARTER,
	type OfferAdmission,
} from "./admission";
import { createOfferedSessions } from "./engine-offers";
import type { DeviceOffer } from "./offers";

/**
 * The offering Device's one admission, run against both paths a call of
 * another Person's run takes: in process, when this computer walks the
 * run itself (`deviceFor`), and after the wire, when a Walker elsewhere
 * sends it through the Host (`serve`). The same calls get the same
 * answers, and one slot map per Offer counts the sessions of both.
 */

const HOST = "host-1";
const SPACE = "space-team";
/** This computer's owner, as the Host knows them. */
const ME = "person-on-host";
const RUN = "abcdef12-0000-0000-0000-000000000000";
const DEVICE = { id: "device-b", name: "hetzner-1" };

let sandbox: Sandbox;
let documents: SpaceDocuments;
let admission: OfferAdmission;
let worktree: string;
/** This computer's own Offers (its Device document), per test. */
let own: DeviceOffer[];
/** The calls this computer's Device ran. */
let ran: { kind: string; input?: unknown }[];
/** The sessions that wait to be ended, and how to end each. */
let waiting: { input: SessionInput; end: () => void }[];

/** This computer as a Device: it records each call. A session whose prompt says "wait" runs until it is ended. */
const device = {
	...DEVICE,
	state: async () => ({ online: true }),
	async capabilities() {
		ran.push({ kind: "capabilities" });
		return { elsewhere: null, harnesses: [], connections: [], clis: [] };
	},
	async flows() {
		ran.push({ kind: "flows" });
		return {};
	},
	async *session(input: SessionInput) {
		ran.push({ kind: "session", input });
		yield { type: "ready", harness: input.harness };
		if (input.prompt.includes("wait")) {
			await new Promise<void>((resolve) => {
				waiting.push({ input, end: resolve });
				input.signal.addEventListener("abort", () => resolve(), {
					once: true,
				});
			});
		}
		yield { type: "finished" };
	},
	async *exec(input: { cwd: string }) {
		ran.push({ kind: "exec", input });
		yield { type: "exit", exitCode: 0, spawnError: null };
	},
	async callTool() {
		ran.push({ kind: "callTool" });
		return {
			kind: "called",
			arguments: {},
			text: "",
			structuredContent: null,
			isError: false,
		};
	},
	async decide() {
		ran.push({ kind: "decide" });
		return { kind: "decided", label: "yes", note: "", costUsd: null };
	},
	async worktree() {
		ran.push({ kind: "worktree" });
		return {
			worktreePath: worktree,
			branch: "nightshift/abcdef12",
			baseRef: "main",
		};
	},
	async handOff() {
		ran.push({ kind: "handOff" });
		return { commit: "c", branch: "b" };
	},
	async receiveHandOff() {
		ran.push({ kind: "receiveHandOff" });
		return { worktreePath: worktree, branch: "b", baseRef: "main" };
	},
	async itemBranch() {
		ran.push({ kind: "itemBranch" });
		return { branch: "b", base: "main" };
	},
} as unknown as Device;

beforeEach(async () => {
	sandbox = await createSandbox();
	own = [];
	ran = [];
	waiting = [];
	documents = createSpaceDocuments({
		db: sandbox.db,
		directory: deviceDirectory(sandbox.db),
	});
	// This computer takes part in the Host's Space "Team", as a member.
	await sandbox.db.insert(hostLink).values({
		hostId: HOST,
		name: "studio",
		addresses: "[]",
		role: "home",
		personId: ME,
		keyStore: "file",
	});
	const [local] = await sandbox.db.select().from(user);
	await createHostSpaces(sandbox.db).update(
		{ id: HOST, name: "studio" },
		[{ id: SPACE, name: "Team", personal: false, role: "member" }],
		local?.id as string,
	);
	await mirror({
		[ME]: "member",
		viewer: "viewer",
		colleague: "member",
		carol: "member",
	});
	// Its Clone of the Space's project.
	await sandbox.db
		.insert(project)
		.values({ id: "p1", spaceId: SPACE, name: "app" });
	await sandbox.db.insert(clone).values({
		id: "c1",
		spaceId: SPACE,
		projectId: "p1",
		deviceId: sandbox.deviceId,
		path: sandbox.repoPath,
	});
	worktree = worktreeLocation(sandbox.repoPath, RUN.slice(0, 8)).worktreePath;
	admission = createOfferAdmission({
		db: sandbox.db,
		device,
		documents,
		ownOffers: () => own,
		// "coder", and "builder" that a test renames to "coder": by id.
		profileFor: (id) =>
			id === "coder" || id === "builder"
				? {
						harness: "claude-code",
						model: "sonnet",
						permissionMode: "bypassPermissions",
						clis: ["gh"],
						connections: [],
					}
				: null,
		sessions: createOfferedSessions(),
	});
});
afterEach(async () => {
	await documents.close();
	await sandbox.cleanup();
});

/** The Space's Members, as its document mirrors them. */
async function mirror(roles: Record<string, string>) {
	const document = await documents.open(SPACE);
	document.doc.transact(() => {
		for (const [id, role] of Object.entries(roles)) {
			document.members.set(id, { name: id, role });
		}
	});
}

/** This computer offers "coder" to the Space: its own entry, and the Space lists it. */
async function offer(sessionCap = 1) {
	own = [
		{
			spaceId: SPACE,
			profile: "coder",
			profileName: "coder",
			permissionCap: "acceptEdits",
			sessionCap,
			offeredAt: 1,
		},
	];
	await listed("coder", sessionCap);
}

async function listed(profile: string, sessionCap = 1) {
	const document = await documents.open(SPACE);
	document.doc.transact(() => {
		document.offers.set(`${DEVICE.id}/${profile}`, {
			deviceId: DEVICE.id,
			deviceName: DEVICE.name,
			profile,
			permissionCap: "acceptEdits",
			sessionCap,
			offeredAt: 1,
			by: ME,
		});
	});
}

/** A run's plan as the walk reads it: only its Person counts here. */
function planBy(personId: string | null): PlacedRun["plan"] {
	const device = { id: DEVICE.id, name: DEVICE.name };
	return { device, named: {}, devices: { [device.id]: device }, personId };
}

function request(overrides: Partial<WorkRequest> = {}): WorkRequest {
	return {
		spaceId: SPACE,
		projectId: "p1",
		personId: "colleague",
		runId: RUN,
		call: exec(worktree),
		...overrides,
	};
}

const exec = (cwd: string): WorkRequest["call"] => ({
	kind: "exec",
	input: { command: "true", cwd },
});

const offered = (
	prompt = "Do the work.",
	extra: { profile?: string; permissionMode?: "plan"; cwd?: string } = {},
): WorkRequest["call"] => ({
	kind: "session",
	input: {
		cwd: extra.cwd ?? worktree,
		prompt,
		offered: {
			profile: extra.profile ?? "coder",
			...(extra.permissionMode ? { permissionMode: extra.permissionMode } : {}),
		},
	},
});

type Path = (
	request: WorkRequest,
	signal: AbortSignal,
) => AsyncIterable<WorkReply>;

/** In process: this computer walks the run, and makes the call on its Device for the run. */
const walkedHere: Path = (request, signal) =>
	serveWork(
		admission.deviceFor({
			id: request.runId ?? "",
			spaceId: request.spaceId,
			projectId: request.projectId,
			plan: planBy(request.personId || null),
		}),
		request,
		signal,
	);

/** After the wire: a Walker elsewhere sends the call through the Host. */
const sentThroughHost: Path = (request, signal) =>
	admission.serve(request, { hostId: HOST }, signal);

/** The two paths of a call of another Person's run to this computer. */
const paths = {
	"walked here": walkedHere,
	"sent through the Host": sentThroughHost,
};

/**
 * What a call comes to: "served", or the refusal, as each Device call
 * shows it (an error, a refused session, a command that did not start, a
 * tool that failed).
 */
function outcomeOf(replies: WorkReply[]): string {
	for (const reply of replies) {
		if (reply.kind === "error") return reply.message;
		const value = (reply.kind === "item" ? reply.item : reply.value) as {
			type?: string;
			kind?: string;
			message?: string;
			spawnError?: string | null;
		};
		if (value?.type === "refused" || value?.type === "error") {
			return value.message ?? "";
		}
		if (value?.type === "exit" && value.spawnError) return value.spawnError;
		if (value?.kind === "failed" || value?.kind === "error") {
			return value.message ?? "";
		}
	}
	return "served";
}

for (const [path, call] of Object.entries(paths)) {
	/** Makes one call by this path, to its end. */
	async function outcome(
		r: WorkRequest,
		signal = new AbortController().signal,
	) {
		const replies: WorkReply[] = [];
		for await (const reply of call(r, signal)) replies.push(reply);
		return outcomeOf(replies);
	}

	describe(`Offer admission, a run ${path}`, () => {
		test("a renamed profile stays offered: a node names its id, a Walker of an older Night Shift its new name", async () => {
			// "builder", offered before profiles had ids, is now named "coder".
			own = [
				{
					spaceId: SPACE,
					profile: "builder",
					profileName: "coder",
					permissionCap: "acceptEdits",
					sessionCap: 1,
					offeredAt: 1,
				},
			];
			await listed("builder");
			expect(
				await outcome(
					request({ call: offered("Do the work.", { profile: "builder" }) }),
				),
			).toBe("served");
			expect(await outcome(request({ call: offered() }))).toBe("served");
			expect(
				await outcome(
					request({ call: offered("Do the work.", { profile: "maker" }) }),
				),
			).toBe('hetzner-1 offers "coder" to this Space, not "maker".');
		});

		test("another Person's run takes an Offer in force: its offered sessions and the run's own folder work", async () => {
			expect(await outcome(request({ call: offered() }))).toBe(
				"hetzner-1 offers nothing to this Space. Its owner can offer a profile on the Agents page.",
			);
			// Its own entry alone, or the Space's alone, is no Offer in force.
			await offer();
			const document = await documents.open(SPACE);
			document.doc.transact(() => document.offers.clear());
			expect(await outcome(request({ call: offered() }))).toContain(
				"offers nothing",
			);
			await listed("coder");
			own = [];
			expect(await outcome(request({ call: offered() }))).toContain(
				"offers nothing",
			);
			await offer();

			expect(await outcome(request({ call: offered() }))).toBe("served");
			expect(
				await outcome(
					request({
						call: { kind: "worktree", run: { id: RUN, projectId: "p1" } },
					}),
				),
			).toBe("served");
			expect(await outcome(request({ call: { kind: "flows" } }))).toBe(
				"served",
			);
			expect(ran.map((r) => r.kind)).toEqual(["session", "worktree", "flows"]);
		});

		test("an offered session runs the profile as its owner set it, the mode no wider than the cap", async () => {
			await offer();
			await outcome(request({ call: offered() }));
			await outcome(
				request({ call: offered("Plan it.", { permissionMode: "plan" }) }),
			);
			const [first, second] = ran.map((r) => r.input as SessionInput);
			expect(first).toMatchObject({
				harness: "claude-code",
				model: "sonnet",
				permissionMode: "acceptEdits",
				clis: ["gh"],
				cwd: worktree,
				prompt: "Do the work.",
			});
			expect("offered" in (first ?? {})).toBe(false);
			// A node may ask for less than the cap; never more.
			expect(second?.permissionMode).toBe("plan");
		});

		test("anything else of another Person's run is refused, and nothing runs", async () => {
			await offer();
			expect(
				await outcome(request({ call: offered("Go.", { profile: "claude" }) })),
			).toBe('hetzner-1 offers "coder" to this Space, not "claude".');
			for (const refused of [
				exec(worktree),
				{ kind: "capabilities", query: {} },
				{
					kind: "callTool",
					input: { connection: "github", tool: "x", arguments: {} },
				},
				{
					kind: "decide",
					input: { decider: "claude-code", prompt: "Go?", labels: [] },
				},
				{
					kind: "session",
					input: {
						cwd: worktree,
						prompt: "Do the work.",
						harness: "claude-code",
						model: "sonnet",
						permissionMode: "bypassPermissions",
					},
				},
			] as WorkRequest["call"][]) {
				expect(await outcome(request({ call: refused }))).toBe(
					'hetzner-1 runs only the profiles its owner offers to this Space. hetzner-1 offers "coder" to this Space.',
				);
			}
			// Its folder rules hold under an Offer too.
			expect(
				await outcome(
					request({ call: offered("Go.", { cwd: sandbox.repoPath }) }),
				),
			).toBe("This device works only in the run's own folder.");
			expect(
				await outcome(
					request({
						call: {
							kind: "worktree",
							run: { id: "another-run", projectId: "p1" },
						},
					}),
				),
			).toBe("This device adds a folder only for the run that asks.");
			expect(ran).toEqual([]);
		});

		test("the starter is a Member whose role uses Offers, at every call", async () => {
			await offer();
			expect(
				await outcome(request({ personId: "stranger", call: offered() })),
			).toBe("This device runs steps for Members of this Space only.");
			expect(
				await outcome(request({ personId: "viewer", call: offered() })),
			).toBe("Your role in this Space does not allow using what others offer.");
			expect(await outcome(request({ call: offered() }))).toBe("served");
			// The colleague's role changes while the run walks: the next call is refused.
			await mirror({ colleague: "viewer" });
			expect(await outcome(request({ call: { kind: "flows" } }))).toBe(
				"Your role in this Space does not allow using what others offer.",
			);
		});

		test("a call whose run names no starter is refused, and nothing runs", async () => {
			await offer();
			for (const r of [
				request({ personId: "", call: offered() }),
				request({ personId: "", call: { kind: "flows" } }),
			]) {
				expect(await outcome(r)).toBe(NO_STARTER);
			}
			expect(ran).toEqual([]);
		});

		test("a session over the Offer's cap waits for a free one, in order; one stopped while it waits leaves", async () => {
			await offer(1);
			const order: string[] = [];
			const first = outcome(request({ call: offered("first, wait") }));
			await until(() => waiting.length === 1);
			const second = outcome(request({ call: offered("second") })).then((o) => {
				order.push("second");
				return o;
			});
			const stopping = new AbortController();
			const third = outcome(
				request({ call: offered("third") }),
				stopping.signal,
			);
			await Bun.sleep(30);
			expect(ran).toHaveLength(1);
			stopping.abort();
			expect(await third).toBe("The session was stopped.");
			waiting[0]?.end();
			expect(await first).toBe("served");
			expect(await second).toBe("served");
			expect(order).toEqual(["second"]);
			expect(ran.map((r) => (r.input as SessionInput).prompt)).toEqual([
				"first, wait",
				"second",
			]);
		});

		test("withdrawing the Offer aborts the sessions under it, and says so to their runs", async () => {
			await offer(1);
			const running = outcome(request({ call: offered("wait") }));
			await until(() => waiting.length === 1);
			// One more waits for the Offer's one session.
			const queued = outcome(request({ call: offered("queued") }));
			admission.withdrawn(SPACE, "other-profile");
			await Bun.sleep(20);
			expect(waiting[0]?.input.signal.aborted).toBe(false);
			admission.withdrawn(SPACE, "coder");
			// Not a Device that went quiet, which a run waits for: a step that fails.
			const withdrawn =
				'hetzner-1 no longer offers "coder" to this Space. Choose another device for this step.';
			expect(await running).toBe(withdrawn);
			expect(await queued).toBe(withdrawn);
			expect(waiting[0]?.input.signal.aborted).toBe(true);
			expect(ran).toHaveLength(1);
		});
	});
}

describe("Offer admission, one slot map per Offer", () => {
	test("a session of a run walked here and one sent through the Host share the Offer's cap", async () => {
		await offer(1);
		const replies = (stream: AsyncIterable<WorkReply>) =>
			(async () => {
				const all: WorkReply[] = [];
				for await (const reply of stream) all.push(reply);
				return outcomeOf(all);
			})();
		const signal = new AbortController().signal;
		const here = replies(
			walkedHere(request({ call: offered("here, wait") }), signal),
		);
		await until(() => waiting.length === 1);
		const sent = replies(
			sentThroughHost(
				request({ personId: "carol", call: offered("sent, wait") }),
				signal,
			),
		);
		await Bun.sleep(50);
		// The cap is 1: the session sent through the Host waits for the one walked here.
		expect(waiting).toHaveLength(1);
		waiting[0]?.end();
		await until(() => waiting.length === 2);
		waiting[1]?.end();
		expect(await here).toBe("served");
		expect(await sent).toBe("served");
	});
});

describe("Offer admission, its owner's run", () => {
	const serve = async (
		r: WorkRequest,
		via: Parameters<OfferAdmission["serve"]>[1] = { hostId: HOST },
	) => {
		const replies: WorkReply[] = [];
		for await (const reply of admission.serve(
			r,
			via,
			new AbortController().signal,
		)) {
			replies.push(reply);
		}
		return outcomeOf(replies);
	};
	const mine = (overrides: Partial<WorkRequest> = {}) =>
		request({ personId: ME, ...overrides });

	test("sent through the Host: served in the run's own folder", async () => {
		expect(await serve(mine())).toBe("served");
		expect(
			await serve(mine({ call: exec(join(worktree, "packages", "app")) })),
		).toBe("served");
		expect(
			await serve(
				mine({ runId: null, call: { kind: "capabilities", query: {} } }),
			),
		).toBe("served");
	});

	test("refuses a Space it does not take part in through this Host, and a role that does not start runs", async () => {
		expect(await serve(mine({ spaceId: sandbox.spaceId }))).toBe(
			"This device does not take part in that Space through this Host.",
		);
		expect(await serve(mine(), { hostId: "another-host" })).toBe(
			"This device does not take part in that Space through this Host.",
		);
		// On a Host, a Walker elsewhere: only in a Space this Host keeps.
		expect(await serve(mine(), { keptHere: true })).toBe(
			"This device does not take part in that Space through this Host.",
		);
		await mirror({ [ME]: "viewer" });
		expect(await serve(mine())).toBe(
			"Your role in this Space does not allow starting runs.",
		);
	});

	test("refuses a project it has no Clone of, and a folder outside the run's worktree", async () => {
		expect(await serve(mine({ projectId: "elsewhere" }))).toBe(
			"This device does not have this project. Add its folder there first.",
		);
		for (const cwd of [sandbox.repoPath, `${worktree}-other`, "/"]) {
			expect(await serve(mine({ call: exec(cwd) }))).toBe(
				"This device works only in the run's own folder.",
			);
		}
		expect(
			await serve(
				mine({
					call: {
						kind: "worktree",
						run: { id: "another-run", projectId: "p1" },
					},
				}),
			),
		).toBe("This device adds a folder only for the run that asks.");
	});

	test("walked here, it is this computer as is: no Offer is in play", async () => {
		const here = admission.deviceFor({
			id: RUN,
			spaceId: SPACE,
			projectId: "p1",
			plan: planBy(ME),
		});
		const replies: WorkReply[] = [];
		for await (const reply of serveWork(
			here,
			mine({ call: exec("/") }),
			new AbortController().signal,
		)) {
			replies.push(reply);
		}
		expect(outcomeOf(replies)).toBe("served");
		expect(ran).toEqual([
			{ kind: "exec", input: expect.objectContaining({ cwd: "/" }) },
		]);
	});
});

async function until(ok: () => boolean, timeoutMs = 5_000) {
	const deadline = Date.now() + timeoutMs;
	while (!ok()) {
		if (Date.now() > deadline) throw new Error("Timed out.");
		await Bun.sleep(5);
	}
}
