import { describe, expect, test } from "bun:test";
import { backupsWithProfile } from "./profile-select";

describe("the backups of a node when its profile changes", () => {
	const host = { device: "host", profile: "builder" };
	const mac = { device: "mac", profile: "builder" };

	test("a backup that becomes the node's own profile goes", () => {
		expect(backupsWithProfile([host, mac], host)).toEqual([mac]);
	});

	test("the same name on another computer is another profile, and stays", () => {
		expect(backupsWithProfile([mac], host)).toEqual([mac]);
	});

	test("no backups left: the field goes", () => {
		expect(backupsWithProfile([host], host)).toBeUndefined();
	});
});
