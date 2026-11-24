import { describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	type Schedule,
	scheduleSchema,
	singleAgentFlow,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { FlowStore } from "../../application/ports";
import type { FlowSave } from "../../domain/flow-save";

/** A store to test, with two Projects that have a flow document. */
export type FlowStoreSetup = {
	store: FlowStore;
	/** Two Projects this Replica knows. */
	projects: [string, string];
	close(): Promise<void>;
};

const quick = (prompt: string): Flow =>
	flowSchema.parse(
		singleAgentFlow({ prompt, model: "sonnet", permissionMode: "acceptEdits" }),
	);

const saving = (name: string, flow: Flow, at: number): FlowSave => ({
	name,
	flow,
	kind: "save",
	personId: "ada",
	deviceId: "laptop",
	at,
});

const here = { deviceId: "laptop", spaceId: "space" };

const nightly = (flow: string, id = "nightly"): Schedule =>
	scheduleSchema.parse({ id, flow, cron: "0 3 * * *" });

/** What a `FlowStore` does, whatever keeps the flows. */
export function flowStoreContract(
	name: string,
	setup: () => Promise<FlowStoreSetup>,
): void {
	describe(`FlowStore: ${name}`, () => {
		async function withStore(
			work: (setup: FlowStoreSetup) => Promise<void>,
		): Promise<void> {
			const given = await setup();
			try {
				await work(given);
			} finally {
				await given.close();
			}
		}

		test("a saved flow reads back with its revision, and a save that changes nothing adds none", () =>
			withStore(async ({ store, projects: [project, other] }) => {
				const flow = quick("Write");
				const stored = await store.save(project, saving("build", flow, 1));
				expect(stored.build).toMatchObject({
					json: { version: FLOW_VERSION, nodes: flow.nodes },
				});
				await store.save(project, saving("build", flow, 2));
				const revisions = await store.revisions(project, "build", "space");
				expect(revisions.map((r) => [r.kind, r.personId, r.at])).toEqual([
					["save", "ada", 1],
				]);
				const read = await store.read(project, here);
				expect(read.build).toEqual({
					json: stored.build && "json" in stored.build ? stored.build.json : {},
					revision: revisions[0]?.id ?? "",
				});
				expect(await store.read(other, here)).toEqual({});
			}));

		test("a removed flow is gone, its revisions stay, and a flow that does not exist is refused", () =>
			withStore(async ({ store, projects: [project] }) => {
				await store.save(project, saving("build", quick("Write"), 1));
				await store.remove(project, "build");
				expect(await store.read(project, here)).toEqual({});
				const refusal = await store.remove(project, "build").catch((e) => e);
				expect(refusal).toBeInstanceOf(Refusal);
				expect((refusal as Refusal).kind).toBe("not-found");
				expect((refusal as Error).message).toBe(
					'The flow "build" does not exist.',
				);
				expect(await store.revisions(project, "gone", "space")).toEqual([]);
			}));

		test("a run's shapes stay on a node without a schema, once", () =>
			withStore(async ({ store, projects: [project] }) => {
				const flow = quick("Write");
				const node = flow.nodes[0];
				if (!node) throw new Error("Expected a node.");
				await store.save(project, saving("build", flow, 1));
				const shape = { type: "object" };
				const keep = {
					name: "build",
					node: { id: node.id, type: node.type },
					shapes: { data: shape },
					deviceId: "desktop",
					at: 5,
				};
				expect(await store.keepShapes(project, keep)).toBe(true);
				expect(await store.keepShapes(project, keep)).toBe(false);
				expect(await store.keepShapes(project, { ...keep, name: "gone" })).toBe(
					false,
				);
				const read = await store.read(project, here);
				const json = read.build && "json" in read.build ? read.build.json : {};
				expect(
					(json as { nodes: { output?: unknown }[] }).nodes[0],
				).toMatchObject({ output: shape, outputInferred: true });
				const revisions = await store.revisions(project, "build", "space");
				expect(revisions.map((r) => [r.kind, r.personId, r.deviceId])).toEqual([
					["save", "ada", "laptop"],
					["infer", null, "desktop"],
				]);
			}));

		test("a run's output types stay on an output without a type", () =>
			withStore(async ({ store, projects: [project] }) => {
				const flow: Flow = {
					...quick("Write"),
					outputs: [{ name: "summary", value: "{{a.text}}" }],
				};
				await store.save(project, saving("build", flow, 1));
				const keep = {
					name: "build",
					types: [{ name: "summary", value: "{{a.text}}", type: "string" }],
					deviceId: "laptop",
					at: 2,
				};
				expect(await store.keepOutputTypes(project, keep)).toBe(true);
				expect(await store.keepOutputTypes(project, keep)).toBe(false);
				const read = await store.read(project, here);
				const json = read.build && "json" in read.build ? read.build.json : {};
				expect((json as { outputs: unknown[] }).outputs).toEqual([
					{
						name: "summary",
						value: "{{a.text}}",
						type: "string",
						inferred: true,
					},
				]);
			}));

		test("the schedules read back in their order", () =>
			withStore(async ({ store, projects: [project] }) => {
				expect(await store.schedules(project)).toEqual({
					schedules: [],
					unreadable: 0,
				});
				const list = [nightly("build", "b"), nightly("build", "a")];
				await store.saveSchedules(project, list);
				expect(await store.schedules(project)).toEqual({
					schedules: list,
					unreadable: 0,
				});
			}));

		test("a merge apart takes no id and no name of what comes later, and runs nothing", () =>
			withStore(async ({ store, projects: [source, destination] }) => {
				await store.saveSchedules(source, [nightly("build", "night")]);
				for (let i = 0; i < 2; i++) {
					await store.merge(source, destination, { at: 9, apart: "abcd" });
				}
				expect((await store.schedules(destination)).schedules).toEqual([
					{ ...nightly("build", "night-abcd"), enabled: false },
				]);
				expect((await store.schedules(source)).schedules).toEqual([
					nightly("build", "night"),
				]);
			}));

		test("a note is added once per marker, also after it was dismissed", () =>
			withStore(async ({ store, projects: [project] }) => {
				const notice = {
					kind: "project-moved",
					message: "It moved.",
					deviceId: "laptop",
					at: 5,
				} as const;
				await store.note(project, "one", notice);
				await store.note(project, "one", notice);
				const notices = await store.notices(project);
				expect(notices).toMatchObject([notice]);
				await store.dismissNotice(project, notices[0]?.id as string);
				await store.note(project, "one", notice);
				expect(await store.notices(project)).toEqual([]);
				await store.note(project, "two", notice);
				expect(await store.notices(project)).toHaveLength(1);
			}));

		test("a notice that is gone is no error", () =>
			withStore(async ({ store, projects: [project] }) => {
				expect(await store.notices(project)).toEqual([]);
				await store.dismissNotice(project, "gone");
				expect(await store.notices(project)).toEqual([]);
			}));

		test("every Project with a document is listed", () =>
			withStore(async ({ store, projects }) => {
				expect((await store.projectIds()).sort()).toEqual([...projects].sort());
			}));

		test("a merge gives a clashing flow a free name, takes the schedules, and runs again safely", () =>
			withStore(async ({ store, projects: [source, destination] }) => {
				await store.save(source, saving("build", quick("Source"), 1));
				await store.save(source, saving("same", quick("Same"), 1));
				await store.saveSchedules(source, [nightly("build")]);
				await store.save(destination, saving("build", quick("Mine"), 2));
				await store.save(destination, saving("same", quick("Same"), 2));
				const plan = { flows: { build: "build-2" }, schedules: {} };
				expect(await store.planMerge(source, destination, {})).toEqual(plan);
				expect(await store.merge(source, destination, { at: 3 })).toEqual(plan);
				const read = await store.read(destination, here);
				expect(Object.keys(read).sort()).toEqual(["build", "build-2", "same"]);
				expect((await store.schedules(destination)).schedules).toEqual([
					nightly("build-2"),
				]);
				expect(
					(await store.revisions(destination, "build-2", "space")).length,
				).toBe(1);
				// Again: nothing more.
				await store.merge(source, destination, { at: 4 });
				expect(Object.keys(await store.read(destination, here)).sort()).toEqual(
					["build", "build-2", "same"],
				);
				expect(
					(await store.revisions(destination, "build-2", "space")).length,
				).toBe(1);
			}));
	});
}
