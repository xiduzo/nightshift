import { describe, expect, test } from "bun:test";

import {
	answerFilesProblem,
	answerFilesSchema,
	base64Bytes,
	MAX_ANSWER_FILES,
	MAX_ANSWER_FILES_BYTES,
} from "./answer-files";

const file = (name: string, content = "aGVsbG8=") => ({
	name,
	mediaType: "text/plain",
	content,
});

describe("answer files", () => {
	test("counts the bytes of base64 without decoding it", () => {
		expect(base64Bytes("aGVsbG8=")).toBe(5);
		expect(base64Bytes("aGk=")).toBe(2);
		expect(base64Bytes("aGVs")).toBe(3);
	});

	test("takes up to the limits, and says what is too much", () => {
		expect(answerFilesProblem([file("a.md"), file("b.png")])).toBeNull();
		expect(
			answerFilesProblem(
				Array.from({ length: MAX_ANSWER_FILES + 1 }, (_, i) => file(`${i}`)),
			),
		).toBe("Add at most 10 files.");
		const large = "A".repeat(((MAX_ANSWER_FILES_BYTES + 3) / 3) * 4);
		expect(answerFilesProblem([file("big.pdf", large)])).toBe(
			"The files are larger than 10 MB together. Add smaller files.",
		);
	});

	test("refuses a name with a folder, and content that is not base64", () => {
		expect(answerFilesSchema.safeParse([file("notes.md")]).success).toBe(true);
		expect(answerFilesSchema.safeParse([file("../x.md")]).success).toBe(false);
		expect(answerFilesSchema.safeParse([file("a\\b.md")]).success).toBe(false);
		expect(
			answerFilesSchema.safeParse([file("a.md", "not base64!")]).success,
		).toBe(false);
	});
});
