import { describe, expect, test } from "bun:test";
import {
	type AnswerCost,
	HELP_AGENTS as ASSISTANT_HELP_AGENTS,
} from "../../assistant";
import type { FlowRevisionItem } from "../../flows";
import type { RevisionKind } from "../../flows/store";
import type {
	HandOffFailure,
	RungBy as LoggedRungBy,
	RunScore as LoggedRunScore,
} from "../../log";
import type {
	Ladder as ReadLadder,
	RunRung as ReadRunRung,
	RUNGS,
} from "../../read/ladder";
import { NEEDED_YOU_REASONS as READ_REASONS } from "../../read/needed-you";
import type { RunDetail, RunSummary } from "../../read/views";
import { NIGHT_RANGES as READ_NIGHT_RANGES } from "../../read/views";
import { NIGHT_RANGES } from "./domain/measure-types";
import {
	type Ladder,
	NEEDED_YOU_REASONS,
	type RevisionIn,
	type RunDetailIn,
	type Rung,
	type RungBy,
	type RunIn,
	type RunRung,
	type RunScore,
	type StepIn,
} from "./domain/runs";
import { type AnswerCostIn, HELP_AGENTS } from "./domain/spend-types";

/*
 * The dashboard's rules declare the shapes and the few values they read
 * of the runs (G1 of the hexagon series). This holds both sides to one
 * meaning: the same values, the same answers, and types that fit.
 */

/** True only when A and B are the same type. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same = <T extends true>(_proof?: T) => true;

describe("the shapes the dashboard reads", () => {
	test("hold the same values as their writers", () => {
		expect(NIGHT_RANGES).toEqual(READ_NIGHT_RANGES);
		expect(NEEDED_YOU_REASONS).toEqual(READ_REASONS);
		expect(HELP_AGENTS).toEqual(ASSISTANT_HELP_AGENTS);
	});

	test("are the same words, and a run of the read model is one", () => {
		expect(
			[
				same<Same<Ladder, ReadLadder>>(),
				same<Same<Rung, (typeof RUNGS)[number]>>(),
				same<Same<RungBy, LoggedRungBy>>(),
				same<Same<RunRung, ReadRunRung>>(),
				same<Same<RunScore, LoggedRunScore>>(),
				same<Same<RevisionIn["kind"], RevisionKind>>(),
				same<Same<NonNullable<StepIn["handOffFailed"]>, HandOffFailure>>(),
				same<RunSummary extends RunIn ? true : false>(),
				same<RunDetail extends RunDetailIn ? true : false>(),
				same<FlowRevisionItem extends RevisionIn ? true : false>(),
				same<AnswerCost extends AnswerCostIn ? true : false>(),
			].every(Boolean),
		).toBe(true);
	});
});
