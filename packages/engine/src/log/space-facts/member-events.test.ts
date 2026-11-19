import { describe, expect, test } from "bun:test";
import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { event, user } from "@nightshift/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { ownDevice } from "../../testing/alone-directory";
import { localSpaceId } from "../../testing/test-support";
import { parseEventRow } from "../run-log/append";
import { createRunLog } from "../run-log/run-log";
import { logMemberChange } from "./member-events";

/** The audit of a Space's Members in its event log, on libsql in memory. */

describe("the audit of Members", () => {
	test("joined, new role and removed go in the Space's log, with who did it", async () => {
		const db = createDb({ DATABASE_URL: ":memory:" });
		await migrateDb(db);
		const walkerId = (await ownDevice(db)).id;
		const spaceId = await localSpaceId(db);
		const log = createRunLog(db, { walkerId, dataDir: "/nowhere" });
		const carol = "person-carol";
		await db.insert(user).values({
			id: carol,
			name: "Carol",
			email: "carol@example.com",
			role: "user",
		});
		const ada = "person-ada";

		await logMemberChange(log, {
			kind: "joined",
			spaceId,
			personId: carol,
			role: "member",
			by: carol,
			invitedBy: ada,
		});
		await logMemberChange(log, {
			kind: "role",
			spaceId,
			personId: carol,
			role: "viewer",
			previousRole: "member",
			by: ada,
		});
		await logMemberChange(log, {
			kind: "removed",
			spaceId,
			personId: carol,
			by: ada,
		});

		const rows = await db
			.select()
			.from(event)
			.where(and(eq(event.spaceId, spaceId), isNull(event.runId)));
		const facts = rows
			.map(parseEventRow)
			.filter((e) => e.type.startsWith("Member"))
			.map((e) => ({ type: e.type, payload: e.payload }));
		expect(facts).toEqual([
			{
				type: "MemberJoined",
				payload: { personId: carol, role: "member", by: carol, invitedBy: ada },
			},
			{
				type: "MemberRoleChanged",
				payload: {
					personId: carol,
					role: "viewer",
					previousRole: "member",
					by: ada,
				},
			},
			{ type: "MemberRemoved", payload: { personId: carol, by: ada } },
		]);
	});
});
