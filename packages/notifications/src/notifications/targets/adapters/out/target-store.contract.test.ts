import { describe, expect, test } from "bun:test";
import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { Expo } from "expo-server-sdk";
import type { PushKind } from "../../../channels";
import { isExpoPushToken, type TARGET_KINDS } from "../../domain/push-targets";
import { drizzleTargetStore } from "./drizzle-target-store";
import { inMemoryTargetStore } from "./in-memory-target-store";
import { targetStoreContract } from "./target-store.contract";

/**
 * The contract of `TargetStore`, on both adapters. The real adapter's
 * side runs on libsql in memory. Then what the domain restates of other
 * code: the kinds of the channels, and the Expo token test of the SDK.
 */

targetStoreContract("in memory", async () => ({
	targetStore: inMemoryTargetStore(),
	close: async () => {},
}));

targetStoreContract("over drizzle", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	return { targetStore: drizzleTargetStore(db), close: async () => {} };
});

/** `true` when each type is assignable to the other, else `false`. */
type SameKinds<A, B> = [A] extends [B]
	? [B] extends [A]
		? true
		: false
	: false;

describe("what the targets restate", () => {
	test("the kinds of push target are the channels' kinds", () => {
		// The type check fails here when the two lists differ.
		const same: SameKinds<PushKind, (typeof TARGET_KINDS)[number]> = true;
		expect(same).toBe(true);
	});

	test("the Expo push token test is the SDK's", () => {
		for (const token of [
			"ExponentPushToken[abc123]",
			"ExpoPushToken[abc]",
			"ExponentPushToken[",
			"ExponentPushToken[abc",
			"xExponentPushToken[abc]",
			"12345678-abcd-ABCD-1234-1234567890ab",
			"12345678-abcd-abcd-1234-1234567890a",
			"https://10.0.0.5/",
			"",
			42,
			null,
		]) {
			expect(isExpoPushToken(token)).toBe(Expo.isExpoPushToken(token));
		}
	});
});
