import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySourcesPorts } from "../adapters/out/in-memory-neighbours";
import { OWNER_ONLY } from "../domain/syncs";
import { saveKnowledgeSource } from "./save-knowledge-source";

/** The use case saveKnowledgeSource, on in-memory adapters. */

const owner = { schedules: true };
const member = { schedules: false };
const web = {
	kit: "kit:knowledge/web" as const,
	inputs: { urls: "https://a.b" },
};

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

describe("saveKnowledgeSource", () => {
	test("adds the flow with a free name, then its schedule", async () => {
		const ports = inMemorySourcesPorts();
		const saved = await saveKnowledgeSource(ports)({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			source: web,
			keepUpToDate: { cron: "0 3 * * 1" },
			may: owner,
		});
		expect(saved).toEqual({ name: "knowledge-web-pages", issues: [] });
		expect(ports.space.calls).toEqual([
			"flows.map",
			"flows.save knowledge-web-pages",
			"listSchedules",
			"saveSchedules",
		]);
		expect(ports.space.schedules).toEqual([
			{
				id: "knowledge-web-pages",
				flow: "knowledge-web-pages",
				inputs: {},
				enabled: true,
				cron: "0 3 * * 1",
			},
		]);
	});

	test("without keepUpToDate the schedules are not read", async () => {
		const ports = inMemorySourcesPorts();
		await saveKnowledgeSource(ports)({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			source: web,
			may: member,
		});
		expect(ports.space.calls).toEqual([
			"flows.map",
			"flows.save knowledge-web-pages",
		]);
	});

	test("refuses a schedule from someone else, and one that is not valid, before anything else", async () => {
		const ports = inMemorySourcesPorts();
		const save = saveKnowledgeSource(ports);
		const forbidden = await refusalOf(
			save({
				actor: NIGHT_SHIFT,
				spaceId: "space-1",
				projectId: "p1",
				source: web,
				keepUpToDate: null,
				may: member,
			}),
		);
		expect(forbidden).toBeInstanceOf(Refusal);
		expect((forbidden as Refusal).message).toBe(OWNER_ONLY);
		const invalid = await refusalOf(
			save({
				actor: NIGHT_SHIFT,
				spaceId: "space-1",
				projectId: "p1",
				source: web,
				keepUpToDate: { cron: "not a cron" },
				may: owner,
			}),
		);
		expect((invalid as Refusal).kind).toBe("invalid");
		expect((invalid as Refusal).message).toStartWith(
			"This schedule is not valid: ",
		);
		expect(ports.space.calls).toEqual([]);
	});
});
