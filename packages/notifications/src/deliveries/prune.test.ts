import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";
import { testDatabase } from "../testing/database";
import {
	createDeliveryLog,
	type DeliveryStatus,
	type NoticeKind,
} from "./deliveries";

let db: Database;
let cleanup: () => void;
beforeEach(async () => {
	({ db, cleanup } = await testDatabase());
});
afterEach(() => cleanup());

test("pruning removes old entries, but keeps a Gate or a wait that can still reach a screen", async () => {
	const log = createDeliveryLog(db);
	const add = (
		key: string,
		kind: NoticeKind,
		status: DeliveryStatus,
		at: number,
	) =>
		log.claim(
			{ personId: "ada", key, kind, spaceId: "", runId: "", stepId: null },
			{ status },
			at,
		);
	await add("missed:old", "schedule-missed", "sent", 10);
	await add("run:old", "run-finished", "sent", 10);
	await add("gate:old-closed", "gate-opened", "withdrawn", 10);
	await add("gate:old-open", "gate-opened", "sent", 10);
	await add("wait:old-live", "device-wait", "held", 10);
	await add("missed:new", "schedule-missed", "sent", 100);

	expect(await log.prune(50)).toBe(3);
	const left = [
		...(await log.ofPersonSince("ada", "schedule-missed", 0)),
		...(await log.ofPersonSince("ada", "gate-opened", 0)),
		...(await log.ofPersonSince("ada", "device-wait", 0)),
		...(await log.ofPersonSince("ada", "run-finished", 0)),
	].map((row) => row.key);
	expect(left.sort()).toEqual(["gate:old-open", "missed:new", "wait:old-live"]);
});
