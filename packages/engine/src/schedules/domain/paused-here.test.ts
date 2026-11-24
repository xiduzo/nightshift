import { expect, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import { readHere, savedHere } from "./paused-here";

const on = {
	id: "night",
	flow: "f",
	inputs: {},
	cron: "0 6 * * *",
	enabled: true,
	person: "ada-there",
} as Schedule;
const off = { ...on, id: "off", enabled: false } as Schedule;
const paused = new Set(["night", "off"]);
const here = readHere(on, paused);

test("a paused schedule reads as off and of no Person, and one that is off reads as it is", () => {
	expect(here).toEqual({
		id: "night",
		flow: "f",
		inputs: {},
		cron: "0 6 * * *",
		enabled: false,
	} as Schedule);
	expect(readHere(off, paused)).toBe(off);
	expect(readHere(on, new Set())).toBe(on);
});

test("a save that leaves it off writes what the document has, also with the clock of the saver", () => {
	for (const saved of [here, { ...here, timeZone: "Asia/Tokyo" }]) {
		expect(savedHere([saved, off], [on, off], paused)).toEqual({
			schedules: [on, off],
			ended: [],
		});
	}
});

test("a change of a paused one is written, and it stays paused here only", () => {
	const changed = { ...here, cron: "0 7 * * *" };
	expect(savedHere([changed, off], [on, off], paused)).toEqual({
		schedules: [{ ...on, cron: "0 7 * * *" }, off],
		ended: [],
	});
});

test("one that a person turns on or removes is not paused any more", () => {
	const turnedOn = { ...here, enabled: true };
	expect(savedHere([turnedOn, off], [on, off], paused)).toEqual({
		schedules: [turnedOn, off],
		ended: ["night"],
	});
	expect(savedHere([here], [on, off], paused).ended).toEqual(["off"]);
	// Off after that is the person's own.
	expect(savedHere([here], [turnedOn], new Set()).schedules).toEqual([here]);
});
