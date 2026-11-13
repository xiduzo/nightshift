/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { RunStatus, RunSummary } from "@nightshift/client";
import { atLocal } from "@nightshift/client/testing";
import { runMeta, runPlace } from "./runs-list";

const MIN = 60_000;
/** Saturday 31 Oct 2026, 07:12 local time. */
const NOW = atLocal(2026, 9, 31, 7, 12);

type Row = Pick<
	RunSummary,
	| "id"
	| "status"
	| "createdAt"
	| "endedAt"
	| "projectId"
	| "gates"
	| "title"
	| "flowName"
	| "costUsd"
	| "costMissing"
	| "costCalls"
	| "test"
>;

function run(fields: Partial<Row> & { status: RunStatus }): Row {
	return {
		id: fields.id ?? fields.status,
		createdAt: NOW - 60 * MIN,
		endedAt: null,
		projectId: "website",
		gates: [],
		title: "Feature factory · WEB-142",
		flowName: "Feature factory",
		costUsd: 0,
		costMissing: 0,
		costCalls: 0,
		...fields,
	};
}

describe("runMeta and runPlace", () => {
	const at = (hour: number, minute: number) =>
		atLocal(2026, 9, 31, hour, minute);

	test("a run on its way: since it started", () => {
		expect(runMeta(run({ status: "running", createdAt: at(6, 40) }))).toBe(
			"since 06:40",
		);
	});

	test("a waiting run: since its oldest open Gate", () => {
		const waiting = run({
			status: "waiting",
			createdAt: at(4, 20),
			gates: [
				{ openedAt: at(4, 50), closedAt: at(5, 0), answeredBy: null },
				{ openedAt: at(5, 48), closedAt: null, answeredBy: null },
				{ openedAt: at(6, 30), closedAt: null, answeredBy: null },
			],
		});
		expect(runMeta(waiting)).toBe("since 05:48");
	});

	test("an ended run: when it ended, and its cost when known", () => {
		expect(
			runMeta(
				run({
					status: "finished",
					endedAt: at(2, 5),
					costUsd: 2.61,
					costCalls: 4,
				}),
			),
		).toBe("02:05 · $2.61");
		expect(runMeta(run({ status: "failed", endedAt: at(1, 22) }))).toBe(
			"01:22",
		);
	});

	test("the project and the flow", () => {
		expect(runPlace(run({ status: "running" }), "website")).toBe(
			"website · Feature factory",
		);
		expect(runPlace(run({ status: "running", flowName: null }), null)).toBe(
			"Quick run",
		);
	});

	test("a test run says so after the flow", () => {
		expect(
			runPlace(
				{
					flowName: "Feature factory",
					test: { pinned: ["spec"], skipped: [] },
				},
				"website",
			),
		).toBe("website · Feature factory · Test run");
	});
});
