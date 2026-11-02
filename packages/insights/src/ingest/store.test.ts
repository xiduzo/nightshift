import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { ATTR, USAGE_EVENT } from "@nightshift/semconv";
import { now } from "@nightshift/time";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { InsightsDb } from "../client";
import { migrationsFolder } from "../migrate/migrate";
import { firstNight, overview, publicNumbers } from "../queries";
import { usageEvent } from "../schema";
import { attribute } from "../schema/keys";
import { ingestLogs } from "./ingest";

const ENTRY = attribute(USAGE_EVENT.installStarted, "install.entry");
const HOST = attribute(USAGE_EVENT.installStarted, "install.host");

function nowNano(): string {
	return (BigInt(now()) * 1_000_000n).toString();
}

function started(installId: string) {
	return {
		resourceLogs: [
			{
				resource: {
					attributes: [
						{ key: ATTR.serviceInstance, value: { stringValue: installId } },
						{ key: ATTR.serviceVersion, value: { stringValue: "1.2.3" } },
						{ key: ATTR.osType, value: { stringValue: "darwin" } },
						{ key: ATTR.hostArch, value: { stringValue: "arm64" } },
					],
				},
				scopeLogs: [
					{
						logRecords: [
							{
								timeUnixNano: nowNano(),
								attributes: [
									{
										key: "event.name",
										value: { stringValue: USAGE_EVENT.installStarted },
									},
									{ key: ENTRY, value: { stringValue: "desktop" } },
									{ key: HOST, value: { boolValue: false } },
								],
							},
							{
								timeUnixNano: nowNano(),
								attributes: [
									{ key: "event.name", value: { stringValue: "not-listed" } },
								],
							},
						],
					},
				],
			},
		],
	};
}

async function database(): Promise<InsightsDb> {
	const client = new PGlite();
	const db = drizzle({ client });
	await migrate(db, { migrationsFolder });
	return db as unknown as InsightsDb;
}

test("an accepted event is inserted and four installs are not enough to publish", async () => {
	const db = await database();
	const result = await ingestLogs(db, started("install-1"), { country: "NL" });
	expect(result.accepted).toBe(1);
	expect(result.refused).toBe(1);
	const rows = await db.select().from(usageEvent);
	expect(rows).toHaveLength(1);
	expect(rows[0]?.country).toBe("NL");
	expect(rows[0]?.eventName).toBe(USAGE_EVENT.installStarted);
	expect(await publicNumbers(db)).toEqual({ ready: false });
	const home = await overview(db);
	expect(home.activeInstallsThisWeek).toBe(1);
	expect(home.nightsWithRunsThisWeek).toBe(0);
	expect(home.flaggedInstallIds).toEqual([]);
}, 30_000);

test("five installs publish the proof numbers and show where the funnel stops", async () => {
	const db = await database();
	for (const id of ["a", "b", "c", "d", "e"]) {
		await ingestLogs(db, started(id), { country: null });
	}
	const numbers = await publicNumbers(db);
	expect(numbers.ready).toBe(true);
	if (!numbers.ready) return;
	expect(numbers.installs).toBe(5);
	expect(numbers.mergedRate).toBeNull();
	expect(numbers.shareWithTwoOrMoreAgents).toBe(0);
	const funnel = await firstNight(db);
	expect(funnel.steps.map((step) => step.step)).toEqual([
		"install",
		"agent",
		"project",
		"checked",
		"flow",
		"schedule",
		"run",
		"finished",
		"pull_request",
		"merged",
	]);
	expect(funnel.steps[0]).toMatchObject({ installs: 5, stopped: 5 });
	expect(funnel.steps[1]?.installs).toBe(0);
	expect(funnel.medianSecondsToFirstFinishedRun).toBeNull();
}, 30_000);
