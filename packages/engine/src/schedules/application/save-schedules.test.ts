import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { allowing } from "../../access/adapters/out/in-memory-access";
import { NotOnThisComputer } from "../../contract";
import type { UsageMoment } from "../../usage";
import { schedulePorts } from "../test-support";
import { saveSchedules } from "./save-schedules";

/** The save of a project's schedules, over a database in memory. */

const P = "project-1";
const SPACE = "space-1";
const ANN = { personId: "person-ann", door: "session" as const };
// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
const HOOK_SECRET = "${HOOK_SECRET}";

const night: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "work",
	nodes: [
		{
			id: "work",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo night",
			stdout: "text",
		},
	],
	edges: [],
};

function nightly(extra: Partial<Schedule> = {}): Schedule {
	return {
		id: "nightly",
		flow: "night",
		inputs: {},
		cron: "0 22 * * *",
		enabled: true,
		...extra,
	};
}

/** A project in a Space, with a Clone here unless the test says otherwise. */
async function project(
	clone: { hasFolder?: boolean; clonedHere?: boolean } = {},
) {
	const ports = await schedulePorts(0);
	for (const spaceId of [SPACE, "space-2"]) {
		ports.access.members.join(spaceId, ANN.personId, "member");
	}
	ports.projects.add({ id: P, spaceId: SPACE, ...clone });
	ports.store.seed(P);
	const usage: UsageMoment[] = [];
	const save = saveSchedules({
		...ports,
		usage: { note: (moment) => usage.push(moment) },
	});
	return {
		ports,
		usage,
		saveAs: save,
		save: (schedules: Schedule[], timeZone?: string, spaceId = SPACE) =>
			save(ANN, {
				spaceId,
				projectId: P,
				schedules,
				...(timeZone !== undefined ? { timeZone } : {}),
			}),
		saved: async () =>
			(await ports.store.list(P, { validate: false })).schedules,
	};
}

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

describe("the save of a project's schedules", () => {
	test("saves schedules with problems too, and returns the issues", async () => {
		const { save, saved } = await project();
		expect(await save([nightly({ flow: "gone" })])).toEqual([
			{
				severity: "error",
				message: 'The flow "gone" does not exist.',
				scheduleId: "nightly",
			},
		]);
		expect(await saved()).toEqual([nightly({ flow: "gone" })]);
	});

	test("a schedule without a problem has no issue", async () => {
		const { ports, save } = await project();
		ports.store.seed(P, { flows: { night: { json: night } } });
		expect(await save([nightly()])).toEqual([]);
	});

	test("replaces every schedule of the project", async () => {
		const { save, saved } = await project();
		await save([nightly({ id: "a" }), nightly({ id: "b" })]);
		await save([nightly({ id: "b", enabled: false })]);
		expect(await saved()).toEqual([nightly({ id: "b", enabled: false })]);
	});

	test("gives the saver's clock to each schedule with a time and no time zone of its own", async () => {
		const { save, saved } = await project();
		await save(
			[
				nightly({ id: "mine" }),
				nightly({ id: "tokyo", timeZone: "Asia/Tokyo" }),
			],
			"Europe/Amsterdam",
		);
		expect((await saved()).map((schedule) => schedule.timeZone)).toEqual([
			"Europe/Amsterdam",
			"Asia/Tokyo",
		]);

		// Without the saver's clock, a schedule keeps none.
		await save([nightly()]);
		expect((await saved())[0]?.timeZone).toBeUndefined();
	});

	test("asks the Offer rule for the Space and the person who saves, with the project's flows", async () => {
		const { ports, save } = await project();
		const flows = { night: { json: { name: "night" } } };
		ports.store.seed(P, { flows });
		await save([nightly()], "Europe/Amsterdam");
		expect(ports.offers.asked).toEqual([
			{
				projectId: P,
				spaceId: SPACE,
				actor: ANN,
				// The rule sees the schedules with the saver's clock.
				schedules: [nightly({ timeZone: "Europe/Amsterdam" })],
			},
		]);
	});

	test("saves what the Offer rule writes: a schedule on another Person's Device runs for the saver", async () => {
		const { ports, save, saved } = await project();
		ports.offers.writeFor("person-ann");
		await save([nightly()]);
		expect(await saved()).toEqual([nightly({ person: "person-ann" })]);
	});

	test("what the Offer rule refuses passes through, and nothing is saved", async () => {
		const { ports, save, saved, usage } = await project();
		const refusal = new Refusal("forbidden", "No Offer covers this flow.");
		ports.offers.refuse(refusal);
		expect(await refusalOf(save([nightly()]))).toBe(refusal);
		expect(await saved()).toEqual([]);
		expect(usage).toEqual([]);
	});

	test("refuses a project with a folder and no Clone on this computer, before the Offers are asked", async () => {
		const { ports, save, saved } = await project({ clonedHere: false });
		const refused = await refusalOf(save([nightly()]));
		expect(refused).toBeInstanceOf(NotOnThisComputer);
		expect(refused).toMatchObject({
			kind: "conflict",
			message:
				"This project is not on this computer. Add its folder here to use it.",
		});
		expect(ports.offers.asked).toEqual([]);
		expect(await saved()).toEqual([]);
	});

	test("a project without a folder needs no Clone", async () => {
		const { save, saved } = await project({
			hasFolder: false,
			clonedHere: false,
		});
		await save([nightly()]);
		expect(await saved()).toEqual([nightly()]);
	});

	test("a project of another Space is not found", async () => {
		const { ports, save } = await project();
		expect(
			await refusalOf(save([nightly()], undefined, "space-2")),
		).toMatchObject({ kind: "not-found" });
		expect(ports.offers.asked).toEqual([]);
	});

	test("notes each saved schedule for the usage numbers", async () => {
		const { save, usage } = await project();
		await save([
			nightly(),
			{
				id: "review",
				flow: "night",
				inputs: {},
				enabled: false,
				webhook: { secret: HOOK_SECRET },
				scorePullRequests: true,
			},
		]);
		expect(usage).toEqual([
			{
				kind: "schedule-changed",
				enabled: true,
				webhook: false,
				scorePullRequests: false,
			},
			{
				kind: "schedule-changed",
				enabled: false,
				webhook: true,
				scorePullRequests: true,
			},
		]);
	});

	test("asks schedule:save: owners, admins and members may, and nobody else", async () => {
		const { ports, saveAs } = await project();
		expect(
			await ports.access.whoMay(
				SPACE,
				(actor) =>
					saveAs(actor, {
						spaceId: SPACE,
						projectId: P,
						schedules: [nightly({ enabled: false })],
					}),
				() => ports.offers.asked,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
