/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { StepSummary } from "@nightshift/client";

import {
	changesSummary,
	computerName,
	linkCaption,
	linkLook,
	moreActions,
	primaryAction,
	type RunLink,
	runFacts,
	runLinks,
	runTimeLine,
	runVerdict,
	sizeLabel,
} from "./run-facts";

const MIN = 60_000;
const NOW = new Date(2026, 9, 23, 10, 0).getTime();

type FactRun = Parameters<typeof runFacts>[0];

function factRun(fields: Partial<FactRun> = {}): FactRun {
	return {
		createdAt: NOW - 30 * MIN,
		endedAt: null,
		costUsd: 0.42,
		costMissing: 0,
		costCalls: 3,
		costEstimated: false,
		...fields,
	} as FactRun;
}

function byLabel(facts: ReturnType<typeof runFacts>) {
	return new Map(facts.map((fact) => [fact.label, fact]));
}

describe("runFacts", () => {
	test("cost, tokens and length, in that order", () => {
		const metrics = {
			tokens: { input: 12_000, output: 345, cacheRead: 9000, cacheWrite: 0 },
		} as FactRun["metrics"];
		const facts = runFacts(factRun({ metrics }), {
			status: "running",
			now: NOW,
		});
		expect(facts.map((fact) => fact.label)).toEqual([
			"Cost",
			"Tokens",
			"Length",
		]);
		const fact = byLabel(facts);
		expect(fact.get("Cost")).toMatchObject({
			value: "$0.42",
			sub: "12.3K tokens",
		});
		expect(fact.get("Tokens")).toMatchObject({
			value: "12.3K",
			sub: "12K in, 345 out · $0.42",
		});
		expect(fact.get("Length")).toMatchObject({
			value: "30 min",
			sub: "So far",
		});
	});

	test("what is not known says —", () => {
		const fact = byLabel(
			runFacts(factRun({ costUsd: 0, costCalls: 0, endedAt: null }), {
				status: "finished",
				now: NOW,
			}),
		);
		expect(fact.get("Cost")?.value).toBe("—");
		expect(fact.get("Tokens")?.value).toBe("—");
		expect(fact.get("Length")?.value).toBe("—");
	});

	test("an ended run counts to its end; the cost says when it is not complete", () => {
		const fact = byLabel(
			runFacts(factRun({ endedAt: NOW - 8 * MIN, costMissing: 1 }), {
				status: "failed",
				now: NOW,
			}),
		);
		expect(fact.get("Length")).toMatchObject({ value: "22 min" });
		expect(fact.get("Length")?.sub).toBeUndefined();
		expect(fact.get("Cost")).toMatchObject({
			value: "$0.42+",
			sub: "A step did not report its cost",
		});
	});
});

describe("runTimeLine", () => {
	const time = (ms: number) => `t${(ms - NOW) / MIN}`;
	test("started while live, ended and how long once it ended", () => {
		expect(runTimeLine(factRun(), "running", time)).toBe("started t-30");
		expect(
			runTimeLine(factRun({ endedAt: NOW - 8 * MIN }), "stopped", time),
		).toBe("ended t-8 · ran 22 min");
	});
});

describe("computerName", () => {
	test("its name, or the Host", () => {
		expect(computerName({ name: "Mac mini", thisDevice: false })).toBe(
			"Mac mini",
		);
		expect(computerName({ name: null, thisDevice: true })).toBe("your Host");
	});
});

describe("linkLook", () => {
	test("a pull request on GitHub, a ticket elsewhere", () => {
		const pr = linkLook("https://github.com/xiduzo/nightshift/pull/415");
		expect(pr).toEqual({ pullRequest: true, number: "#415", site: "GitHub" });
		expect(linkCaption(pr)).toEqual(["Pull request", "opens on GitHub"]);
		const ticket = linkLook("https://www.example.com/browse/ZAC-1");
		expect(ticket).toEqual({
			pullRequest: false,
			number: null,
			site: "example.com",
		});
		expect(linkCaption(linkLook("not a url"))).toEqual([
			"Link",
			"opens in the browser",
		]);
	});
});

describe("runVerdict", () => {
	const base = {
		gateQuestion: null,
		step: null,
		computer: "Mac mini",
		notice: null,
		pullRequests: 0,
	};
	test("one sentence per status", () => {
		expect(
			runVerdict({ ...base, status: "waiting", gateQuestion: "Which one?" }),
		).toBe("Which one?");
		expect(runVerdict({ ...base, status: "running", step: "build" })).toBe(
			"Now at build, on Mac mini.",
		);
		expect(
			runVerdict({
				...base,
				status: "failed",
				notice: { gist: "The tests failed." },
			}),
		).toBe("The tests failed.");
		expect(runVerdict({ ...base, status: "finished" })).toBe(
			"It finished without a pull request.",
		);
		expect(runVerdict({ ...base, status: "finished", pullRequests: 2 })).toBe(
			"It made 2 pull requests.",
		);
	});
});

describe("primaryAction and moreActions", () => {
	const none = { stop: false, resume: false, restart: false, rerun: false };
	const input = {
		status: "running" as const,
		allows: none,
		gate: null,
		resumeAt: "build",
		canRestart: false,
		canRerun: true,
		links: [] as RunLink[],
	};
	test("a waiting run answers its Gate; Stop moves to more", () => {
		const waiting = {
			...input,
			status: "waiting" as const,
			allows: { ...none, stop: true },
			gate: { stepId: "s1" },
		};
		const primary = primaryAction(waiting);
		expect(primary).toEqual({ kind: "answer", stepId: "s1" });
		expect(moreActions(waiting, primary)).toEqual(["stop"]);
	});
	test("a running run stops; a restart stays in more", () => {
		const running = {
			...input,
			allows: { ...none, stop: true, restart: true },
			canRestart: true,
		};
		const primary = primaryAction(running);
		expect(primary).toEqual({ kind: "stop" });
		expect(moreActions(running, primary)).toEqual(["restart"]);
	});
	test("failed retries, stopped resumes at its step, run again goes to more", () => {
		const allows = { ...none, resume: true, rerun: true };
		const failed = { ...input, status: "failed" as const, allows };
		expect(primaryAction(failed)).toEqual({ kind: "resume", label: "Retry" });
		expect(moreActions(failed, primaryAction(failed))).toEqual(["rerun"]);
		expect(
			primaryAction({ ...input, status: "interrupted" as const, allows }),
		).toEqual({ kind: "resume", label: "Resume at build" });
	});
	test("a failed run that cannot resume runs again", () => {
		expect(
			primaryAction({
				...input,
				status: "failed",
				allows: { ...none, rerun: true },
			}),
		).toEqual({ kind: "rerun" });
	});
	test("a finished run opens its pull request, or offers nothing", () => {
		const link = (url: string): RunLink => ({
			id: url,
			title: "A",
			state: "done",
			branch: null,
			url,
		});
		const finished = { ...input, status: "finished" as const };
		expect(
			primaryAction({
				...finished,
				links: [
					link("https://example.com/browse/ZAC-1"),
					link("https://github.com/a/b/pull/415"),
				],
			}),
		).toEqual({
			kind: "open",
			url: "https://github.com/a/b/pull/415",
			label: "Open #415",
		});
		expect(primaryAction(finished)).toBeNull();
	});
});

describe("changesSummary", () => {
	test("files once each, plus the ones left out, and all lines", () => {
		const file = (path: string) => ({ path }) as never;
		expect(
			changesSummary([
				{ files: [file("a"), file("b")], added: 10, removed: 2, omitted: 0 },
				{ files: [file("b")], added: 3, removed: 1, omitted: 1 },
			]),
		).toBe("3 files · +13 −3");
		expect(
			changesSummary([
				{ files: [file("a")], added: 1, removed: 0, omitted: 0 },
			]),
		).toBe("1 file · +1 −0");
	});
});

describe("runLinks", () => {
	test("the items with a link, once each, in order", () => {
		const item = (id: string, url: string | null) => ({
			id,
			title: `Item ${id}`,
			url,
			value: null,
			state: "done" as const,
			branch: id === "1" ? "feat/one" : null,
			baseBranch: null,
			startedAt: 0,
			endedAt: 1,
			reason: null,
		});
		const steps = [
			{ items: [item("1", "https://example.com/pull/1"), item("2", null)] },
			{
				items: [
					item("1", "https://example.com/pull/1"),
					item("3", "https://example.com/pull/3"),
				],
			},
		] as Pick<StepSummary, "items">[];
		expect(runLinks(steps).map((link) => link.id)).toEqual(["1", "3"]);
	});
});

describe("sizeLabel", () => {
	test("bytes, KB, MB", () => {
		expect(sizeLabel(512)).toBe("512 B");
		expect(sizeLabel(12 * 1024)).toBe("12 KB");
		expect(sizeLabel(1.4 * 1024 * 1024)).toBe("1.4 MB");
	});
});
