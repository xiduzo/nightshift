import { expect, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import { isPausedForm, pausedForm } from "./paused-schedule";

const was = {
	id: "night",
	flow: "f",
	inputs: { a: "1", b: "2" },
	cron: "0 6 * * *",
	enabled: true,
	person: "ada",
} as Schedule;

test("a pause turns the schedule off and takes its Person", () => {
	expect(pausedForm(was)).toEqual({
		id: "night",
		flow: "f",
		inputs: { a: "1", b: "2" },
		cron: "0 6 * * *",
		enabled: false,
	} as Schedule);
});

test("it is as the pause left it only while nobody changed a field, whatever their order", () => {
	const paused = pausedForm(was);
	expect(isPausedForm(paused, was)).toBe(true);
	expect(isPausedForm({ ...paused, inputs: { b: "2", a: "1" } }, was)).toBe(
		true,
	);
	expect(isPausedForm({ ...paused, cron: "0 7 * * *" }, was)).toBe(false);
	expect(isPausedForm({ ...paused, person: "ada" }, was)).toBe(false);
	expect(isPausedForm({ ...paused, inputs: { a: "1" } }, was)).toBe(false);
	expect(isPausedForm(was, was)).toBe(false);
});
