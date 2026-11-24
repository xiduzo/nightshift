import { expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "@nightshift/refusal";
import { versionMessage } from "./version";

test("an app says what to update, once its Night Shift says another version", () => {
	expect(versionMessage("phone", PROTOCOL_VERSION)).toBeNull();
	expect(versionMessage("page", PROTOCOL_VERSION)).toBeNull();
	// Not signed in, or not yet let in: nothing to compare.
	expect(versionMessage("phone", null)).toBeNull();
	expect(versionMessage("phone", PROTOCOL_VERSION + 1)).toContain(
		"Close the app",
	);
	expect(versionMessage("phone", undefined)).toContain(
		"Update Night Shift there.",
	);
	expect(versionMessage("page", PROTOCOL_VERSION + 1)).toContain("Reload");
});
