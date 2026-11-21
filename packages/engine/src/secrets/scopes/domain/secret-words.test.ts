import { describe, expect, test } from "bun:test";
import { PERSONAL_ON_HOST } from "./secret-scopes";
import {
	NEEDS_A_VALUE,
	notInProject,
	notInSpace,
	notPersonal,
	notReadLine,
	noValueHere,
	PERSONAL_UNREACHABLE,
	PROJECT_UNREACHABLE,
	unreachableNote,
} from "./secret-words";

/** The sentences a person reads, whole: a change of one is a change of what a door answers. */

describe("the words of secrets", () => {
	test("each sentence, whole", () => {
		expect(PROJECT_UNREACHABLE).toBe(
			"Night Shift could not read this project's secrets now. Check that this computer is online, then try again.",
		);
		expect(PERSONAL_UNREACHABLE).toBe(
			"Night Shift could not read your Personal secrets now. Check that this computer is online, then try again.",
		);
		expect(NEEDS_A_VALUE).toBe("A secret needs a value.");
		expect(noValueHere("TOKEN")).toBe(
			"This computer has no saved value of TOKEN.",
		);
		expect(notPersonal("TOKEN")).toBe("TOKEN is not a Personal secret.");
		expect(notInProject("TOKEN")).toBe(
			"TOKEN is not a secret of this project.",
		);
		expect(notInSpace("TOKEN")).toBe("TOKEN is not a secret of this Space.");
		expect(notReadLine("listed", "Personal")).toBe(
			"[secrets] the Personal secrets were not listed:",
		);
	});

	test("the note of a missing secret names each scope that could not be read", () => {
		expect(unreachableNote({})).toBe("");
		expect(
			unreachableNote({
				projectUnreachable: true,
				unreachable: true,
				personalHere: true,
			}),
		).toBe(
			` ${PROJECT_UNREACHABLE} ${PERSONAL_UNREACHABLE} ${PERSONAL_ON_HOST}`,
		);
	});
});
