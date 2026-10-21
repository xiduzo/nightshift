import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { event, user } from "@nightshift/db/schema";
import { createSpaceDocuments, type SpaceDocuments } from "@nightshift/engine";
import {
	createSandbox,
	parseEventRow,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";
import type { AgentProfileSettings, Flow, FlowNode } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import { createPeerEngine, deviceDirectory, type PeerEngine } from "../peers";
import { withPeers } from "../testing";
import {
	createOfferSlots,
	type DeviceOffer,
	offeredSession,
	offerRefusal,
	spaceOffers,
} from "./offers";

/**
 * Offers on the engine's side: the run start's rule (`offerRefusal`), the
 * offering Device's resolution of an offered session and its session cap,
 * and a run of another Person on the computer that walks it: placed
 * through this computer's Offers, its profile resolved here and never in
 * the run's copy, stopped when the Offer is withdrawn, the Offer's facts
 * in the Space's log.
 */

const node = (n: Partial<FlowNode> & { id: string; type: string }) =>
	({ position: { x: 0, y: 0 }, ...n }) as FlowNode;

const agent = (extra: Record<string, unknown> = {}) =>
	node({ id: "work", type: "agent", prompt: "Do the work.", ...extra });

const placed = {
	deviceName: "hetzner-1",
	offers: [{ profile: "coder", permissionCap: "acceptEdits" as const }],
	mayUse: true,
};

describe("offerRefusal: the Walker's check at run start", () => {
	test("a flow that touches nothing on the Device needs no Offer", () => {
		const gate = node({
			id: "ship",
			type: "decision",
			prompt: "Ship?",
			options: [{ name: "yes" }],
			by: "person",
		});
		expect(
			offerRefusal([gate], { ...placed, offers: [], mayUse: false }),
		).toBeNull();
	});

	test("an Agent node that names an offered profile, and sets nothing it sets, passes", () => {
		expect(offerRefusal([agent({ profile: "coder" })], placed)).toBeNull();
		expect(
			offerRefusal(
				[agent({ profile: "coder", permissionMode: "plan" })],
				placed,
			),
		).toBeNull();
	});

	test("refusals name the Device and what it offers", () => {
		expect(
			offerRefusal([agent({ profile: "coder" })], { ...placed, mayUse: false }),
		).toBe(
			"hetzner-1 is not your device, and your role in this Space does not allow using what others offer.",
		);
		expect(
			offerRefusal([agent({ profile: "coder" })], { ...placed, offers: [] }),
		).toBe(
			"hetzner-1 is not your device. It offers nothing to this Space. A run can use your own devices, or a profile another person offers to this Space.",
		);
		expect(offerRefusal([agent({ profile: "claude" })], placed)).toBe(
			'hetzner-1 offers "coder" to this Space, not "claude". Change the profile of "work".',
		);
		expect(
			offerRefusal(
				[
					agent({ profile: "coder" }),
					node({ id: "build", type: "command", command: "make" }),
				],
				placed,
			),
		).toBe(
			'hetzner-1 is not your device. It runs only Agent nodes with a profile its owner offers to this Space, not "build". Choose one of your own devices for this run.',
		);
		expect(
			offerRefusal([agent({ profile: "coder", model: "opus" })], placed),
		).toBe(
			'The Agent node "work" sets its own model. On hetzner-1, the offered profile "coder" runs as its owner set it. Remove them from the node.',
		);
	});

	test("a permission mode wider than the cap is refused", () => {
		expect(
			offerRefusal(
				[agent({ profile: "coder", permissionMode: "bypassPermissions" })],
				placed,
			),
		).toBe(
			'The Agent node "work" asks for the permission mode bypassPermissions, but hetzner-1 offers "coder" with acceptEdits at most. Choose acceptEdits or a narrower mode.',
		);
	});
});

const coder: AgentProfileSettings = {
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "bypassPermissions",
	clis: ["gh"],
	connections: ["github"],
};

describe("the offering Device", () => {
	test("resolves an offered session to its own profile, the permission mode at most the cap", () => {
		const base = { cwd: "/w", prompt: "Do the work." };
		expect(
			offeredSession({ ...base, offered: { profile: "coder" } }, coder, "auto"),
		).toEqual({
			...base,
			harness: "claude-code",
			model: "sonnet",
			permissionMode: "auto",
			clis: ["gh"],
			connections: ["github"],
		});
		// A node may ask for less than the cap; never more.
		expect(
			offeredSession(
				{ ...base, offered: { profile: "coder", permissionMode: "plan" } },
				coder,
				"acceptEdits",
			).permissionMode,
		).toBe("plan");
		expect(
			offeredSession(
				{
					...base,
					offered: { profile: "coder", permissionMode: "bypassPermissions" },
				},
				coder,
				"acceptEdits",
			).permissionMode,
		).toBe("acceptEdits");
	});

	test("a session over the cap waits for a free one, in order; one stopped while it waits leaves", async () => {
		const slots = createOfferSlots();
		const signal = new AbortController().signal;
		const first = await slots.take("o", 1, signal);
		const order: string[] = [];
		const second = slots.take("o", 1, signal).then((release) => {
			order.push("second");
			return release;
		});
		const stopped = new AbortController();
		const third = slots.take("o", 1, stopped.signal);
		await Bun.sleep(10);
		expect(order).toEqual([]);
		expect(slots.running("o")).toBe(1);
		stopped.abort();
		await expect(third).rejects.toThrow("The session was stopped.");
		first();
		(await second)();
		expect(order).toEqual(["second"]);
		expect(slots.running("o")).toBe(0);
	});
});

describe("another Person's run on the computer that walks it", () => {
	let sandbox: Sandbox;
	let documents: SpaceDocuments;
	let signal: AbortController;
	let own: DeviceOffer[];
	let engine: PeerEngine;
	const harness = fakeHarness((input) => ({
		steps: [{ type: "wait", ms: input.prompt.includes("slow") ? 60_000 : 1 }],
	}));
	const carol = "person-carol";

	const flow = (prompt: string, extra: Record<string, unknown> = {}): Flow => ({
		version: 5,
		inputs: [],
		outputs: [],
		start: "work",
		nodes: [agent({ profile: "coder", prompt, ...extra })],
		edges: [],
	});

	beforeEach(async () => {
		sandbox = await createSandbox();
		documents = createSpaceDocuments({
			db: sandbox.db,
			directory: deviceDirectory(sandbox.db),
		});
		signal = new AbortController();
		own = [];
		await sandbox.db
			.insert(user)
			.values({ id: carol, name: "Carol", email: "carol@example.com" });
		engine = createPeerEngine(
			withPeers({
				db: sandbox.db,
				harnesses: { "claude-code": harness },
				deviceId: sandbox.deviceId,
				dataDir: sandbox.dataDir,
				scheduler: false,
				spaceDocuments: documents,
				profileFor: (name) =>
					name === "coder" ? { ...coder, connections: [] } : null,
				ownOffers: () => own,
				mayUseOffers: async (_space, person) => person === carol,
			}),
			{ signal: signal.signal },
		);
	});
	afterEach(async () => {
		signal.abort();
		await documents.close();
		await sandbox.cleanup();
	});

	async function offer() {
		own = [
			{
				spaceId: sandbox.spaceId,
				profile: "coder",
				permissionCap: "acceptEdits",
				sessionCap: 1,
				offeredAt: Date.now(),
			},
		];
		await engine.offers.publish({
			spaceId: sandbox.spaceId,
			deviceId: sandbox.deviceId,
			deviceName: "studio",
			profile: "coder",
			permissionCap: "acceptEdits",
			sessionCap: 1,
			by: "the-owner",
		});
	}

	async function spaceEvents(type: string) {
		return (
			await sandbox.db.select().from(event).where(eq(event.type, type))
		).map((row) => parseEventRow(row).payload);
	}

	test("without an Offer it is refused at start", async () => {
		const space = engine.space(sandbox.spaceId);
		const { id: projectId } = await space.addProject({
			repoPath: sandbox.repoPath,
		});
		await expect(
			space.startRun({ projectId, flow: flow("Go."), startedBy: carol }),
		).rejects.toThrow("is not your device. It offers nothing to this Space.");
	});

	test("through an Offer it runs the profile resolved here, never in the run's copy; withdrawing stops it", async () => {
		await offer();
		const space = engine.space(sandbox.spaceId);
		const { id: projectId } = await space.addProject({
			repoPath: sandbox.repoPath,
		});
		expect(
			(
				await engine
					.space(sandbox.spaceId, { personId: carol })
					.listPlacements(projectId)
			)[0]?.offers,
		).toEqual(["coder"]);

		const quick = await space.startRun({
			projectId,
			flow: flow("Go."),
			startedBy: carol,
		});
		await waitFor(
			async () => (await space.getRun(quick.id)).status === "finished",
			{ label: "the run" },
		);
		expect(harness.calls.at(-1)).toMatchObject({
			model: "sonnet",
			permissionMode: "acceptEdits",
			clis: ["gh"],
		});
		const detail = await space.getRun(quick.id);
		expect(JSON.stringify(detail)).not.toContain("sonnet");

		const slow = await space.startRun({
			projectId,
			flow: flow("Go slow."),
			startedBy: carol,
		});
		await waitFor(() => harness.calls.at(-1)?.prompt.includes("slow"), {
			label: "the slow session",
		});
		await engine.offers.withdraw({
			spaceId: sandbox.spaceId,
			deviceId: sandbox.deviceId,
			profile: "coder",
			by: "the-owner",
		});
		await waitFor(
			async () => (await space.getRun(slow.id)).status === "stopped",
			{ label: "the stop" },
		);
		expect(spaceOffers(await documents.open(sandbox.spaceId))).toEqual([]);
		expect(await spaceEvents("OfferMade")).toEqual([
			{
				deviceId: sandbox.deviceId,
				deviceName: "studio",
				profile: "coder",
				permissionCap: "acceptEdits",
				sessionCap: 1,
				by: "the-owner",
			},
		]);
		expect(await spaceEvents("OfferWithdrawn")).toEqual([
			{ deviceId: sandbox.deviceId, profile: "coder", by: "the-owner" },
		]);
	});

	test("the Space document publishes the Offer's name and caps, nothing of the profile", async () => {
		await offer();
		const document = await documents.open(sandbox.spaceId);
		const [entry] = [...document.offers.values()];
		expect(Object.keys(entry as object).sort()).toEqual([
			"by",
			"deviceId",
			"deviceName",
			"offeredAt",
			"permissionCap",
			"profile",
			"sessionCap",
		]);
		expect(JSON.stringify(document.doc.toJSON())).not.toContain("sonnet");
	});
});

describe("a schedule that fires on another Person's Device", () => {
	const TICK_MS = 5;
	const carol = "person-carol";
	/** Local time, October 2026. */
	const at = (day: number, hours: number, minutes = 0, seconds = 0) =>
		new Date(2026, 9, day, hours, minutes, seconds).getTime();
	let sandbox: Sandbox;
	let documents: SpaceDocuments;
	let signal: AbortController;
	let own: DeviceOffer[];
	let engine: PeerEngine;
	let clock: number;

	beforeEach(async () => {
		sandbox = await createSandbox();
		documents = createSpaceDocuments({
			db: sandbox.db,
			directory: deviceDirectory(sandbox.db),
		});
		signal = new AbortController();
		own = [];
		clock = at(16, 21, 59);
		await sandbox.db
			.insert(user)
			.values({ id: carol, name: "Carol", email: "carol@example.com" });
		engine = createPeerEngine(
			withPeers({
				db: sandbox.db,
				harnesses: { "claude-code": fakeHarness() },
				deviceId: sandbox.deviceId,
				dataDir: sandbox.dataDir,
				spaceDocuments: documents,
				profileFor: (name) =>
					name === "coder" ? { ...coder, connections: [] } : null,
				ownOffers: () => own,
				mayUseOffers: async (_space, person) => person === carol,
			}),
			{ signal: signal.signal, now: () => clock, scheduleTickMs: TICK_MS },
		);
	});
	afterEach(async () => {
		signal.abort();
		await Bun.sleep(TICK_MS * 4);
		await documents.close();
		await sandbox.cleanup();
	});

	test("is refused when saved without an Offer; through one it starts Carol's runs, until it is withdrawn", async () => {
		const owner = engine.space(sandbox.spaceId);
		const { id: projectId } = await owner.addProject({
			repoPath: sandbox.repoPath,
		});
		await owner.saveFlow(projectId, "night", {
			version: 5,
			inputs: [],
			outputs: [],
			start: "work",
			nodes: [agent({ profile: "coder" })],
			edges: [],
		});
		// Carol saves a schedule that fires on this computer, which she does not own.
		const space = engine.space(sandbox.spaceId, { personId: carol });
		const [here] = await space.listDevices(projectId);
		const schedule = {
			id: "nightly",
			flow: "night",
			inputs: {},
			cron: "0 22 * * *",
			enabled: true,
			device: here?.name as string,
		};
		await expect(space.saveSchedules(projectId, [schedule])).rejects.toThrow(
			`The schedule "nightly" fires on another person's device. ${here?.name} is not your device. It offers nothing to this Space.`,
		);

		own = [
			{
				spaceId: sandbox.spaceId,
				profile: "coder",
				permissionCap: "acceptEdits",
				sessionCap: 1,
				offeredAt: 1,
			},
		];
		await engine.offers.publish({
			spaceId: sandbox.spaceId,
			deviceId: sandbox.deviceId,
			deviceName: here?.name as string,
			profile: "coder",
			permissionCap: "acceptEdits",
			sessionCap: 1,
			by: null,
		});
		await space.saveSchedules(projectId, [schedule]);
		expect((await space.listSchedules(projectId)).schedules[0]?.person).toBe(
			carol,
		);

		clock = at(16, 22, 0, 20);
		const run = await waitFor(async () => (await owner.listRuns())[0], {
			label: "the scheduled run",
		});
		expect(run.startedBy?.id).toBe(carol);
		await waitFor(
			async () => (await owner.getRun(run.id)).status === "finished",
			{ label: "the run" },
		);

		await engine.offers.withdraw({
			spaceId: sandbox.spaceId,
			deviceId: sandbox.deviceId,
			profile: "coder",
			by: null,
		});
		clock = at(17, 22, 0, 20);
		const failed = await waitFor(
			async () =>
				(
					await sandbox.db
						.select()
						.from(event)
						.where(eq(event.type, "ScheduleFired"))
				)
					.map((row) => parseEventRow(row).payload as { error: string | null })
					.find((p) => p.error !== null),
			{ label: "the refused fire" },
		);
		expect(failed.error).toContain("It offers nothing to this Space.");
		expect(await owner.listRuns()).toHaveLength(1);
	});
});
