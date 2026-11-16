import { describe, expect, test } from "bun:test";
import { factsLine, type TellOutcome, tellReply } from "./overview-words";

describe("the facts under the overview's heading", () => {
	test("files, their sources, and how often a question found an answer", () => {
		expect(factsLine({ files: 128, sources: 4, asked: 12, answered: 9 })).toBe(
			"128 files from 4 sources · 9 of 12 questions found an answer",
		);
		expect(factsLine({ files: 1, sources: 1, asked: 0, answered: 0 })).toBe(
			"1 file from 1 source",
		);
		expect(factsLine({ files: 3, sources: 0, asked: 1, answered: 0 })).toBe(
			"3 files · 0 of 1 question found an answer",
		);
	});

	test("with no file, how to start", () => {
		expect(factsLine({ files: 0, sources: 0, asked: 2, answered: 0 })).toBe(
			"No files yet. Tell a fact or paste a link to start.",
		);
	});
});

const nothing: TellOutcome = {
	note: false,
	read: [],
	agent: 0,
	started: true,
	gone: 0,
	unread: 0,
	failed: [],
};

describe("Night Shift's answer to a Tell", () => {
	test("a note", () => {
		expect(tellReply({ ...nothing, note: true })).toBe(
			"Saved. Agents read it from their next run.",
		);
	});

	test("links it reads: now, and how often it checks them", () => {
		expect(tellReply({ ...nothing, read: ["week"] })).toBe(
			"Night Shift reads the link now and checks it for changes every week.",
		);
		expect(tellReply({ ...nothing, read: ["day", "day"] })).toBe(
			"Night Shift reads the 2 links now and checks them for changes every day.",
		);
		expect(tellReply({ ...nothing, read: ["day", "once"] })).toBe(
			"Night Shift reads the 2 links now and checks them for changes every day.",
		);
		expect(tellReply({ ...nothing, read: ["day", "week"] })).toBe(
			"Night Shift reads the 2 links now and checks them for changes as you chose.",
		);
		expect(tellReply({ ...nothing, read: ["once"] })).toBe(
			"Night Shift reads the link now.",
		);
	});

	test("what an agent fetches, and what stays out", () => {
		expect(
			tellReply({ ...nothing, note: true, agent: 1, gone: 1, unread: 2 }),
		).toBe(
			"Saved. Agents read it from their next run. An agent fetches it now. What it saves shows under All knowledge. One link does not load. Check the address and tell it again. Night Shift cannot read 2 links, so they stay out.",
		);
	});

	test("what did not save, and nothing at all", () => {
		expect(tellReply({ ...nothing, failed: ["This did not save: no."] })).toBe(
			"This did not save: no.",
		);
		expect(tellReply(nothing)).toBe("Nothing to save.");
	});
});
