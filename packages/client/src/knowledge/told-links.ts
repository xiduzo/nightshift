import {
	type KnowledgeSource,
	timeAndDaysToCron,
	WEB_MAX_PAGES,
} from "@nightshift/flows";

import type { ApiOutputs } from "../api";

/**
 * What a person tells the knowledge in words and links (the Knowledge
 * overview's Tell): the links in the text, what the quick look at each one
 * offers, and the source each one becomes. One rule for both apps.
 */

/** The quick look at one link (`knowledge.look`). */
export type LinkLook = ApiOutputs["knowledge"]["look"][number];

/** How often a told source reads its link again. `once`: only now. */
export type HowOften = "day" | "week" | "month" | "once";

/** How much of a page's folder to read: the page, the first pages, or all of them. */
export type HowMuch = "page" | "first" | "all";

/** Above this many pages, reading the whole folder is a choice, not the default. */
export const FOLDER_DEFAULT_PAGES = 100;

/** The time of day a told source reads again: the one of the Add source dialog. */
const READ_AT = "06:00";
const MONDAY = 1;

const LINK = /https?:\/\/[^\s<>"')\]]+/g;

/** Every web address in a text, in order, once each, without the dot that ends a sentence. */
export function linksIn(text: string): string[] {
	const found = (text.match(LINK) ?? []).map((link) =>
		link.replace(/[.,;:!?]+$/, ""),
	);
	return [...new Set(found)];
}

/**
 * The note in a told text: the whole text when it has words besides its
 * links ("Refunds take 14 days. The policy is on https://…"), else null (only
 * links). The links stay in the note: an agent can follow them.
 */
export function toldNote(text: string): string | null {
	const words = text.replace(LINK, " ").replace(/\s+/g, " ").trim();
	return words === "" ? null : text.trim();
}

/** The part of a folder a person can choose to read, with how many pages that is. */
export type MuchChoice = { much: HowMuch; pages: number };

/**
 * What a told link offers, from its quick look:
 * - `read`: Night Shift reads it (a page, a folder of pages, a feed, a
 *   file). `much` lists the choices for a page in a folder of more pages,
 *   or is null. `often` is the default of How often.
 * - `agent`: Night Shift cannot read it as it is (a sign-in, a page that
 *   shows only in a browser, a site that keeps readers out, video or audio).
 *   An agent can fetch it: the person chooses that.
 * - `none`: nothing loads at the address.
 */
export type LinkPlan =
	| {
			action: "read";
			much: { choices: MuchChoice[]; initial: HowMuch } | null;
			often: HowOften;
	  }
	| { action: "agent"; transcript: boolean; often: HowOften }
	| { action: "none" };

export function linkPlan(look: LinkLook): LinkPlan {
	switch (look.kind) {
		case "page":
		case "section": {
			const section = look.section;
			if (!section || section.pages <= 1) {
				return { action: "read", much: null, often: "week" };
			}
			const all = Math.min(section.pages, WEB_MAX_PAGES);
			const choices: MuchChoice[] =
				section.pages > FOLDER_DEFAULT_PAGES
					? [
							{ much: "page", pages: 1 },
							{ much: "first", pages: FOLDER_DEFAULT_PAGES },
							{ much: "all", pages: all },
						]
					: [
							{ much: "page", pages: 1 },
							{ much: "all", pages: all },
						];
			const starts = look.kind === "section" || section.starts;
			const initial: HowMuch = !starts
				? "page"
				: section.pages > FOLDER_DEFAULT_PAGES
					? "first"
					: "all";
			return { action: "read", much: { choices, initial }, often: "week" };
		}
		case "feed":
			return { action: "read", much: null, often: "day" };
		case "file":
			return { action: "read", much: null, often: "week" };
		case "media":
			// A recording does not change: its transcript is read once.
			return { action: "agent", transcript: true, often: "once" };
		case "signin":
		case "needs-browser":
		case "blocked":
		case "failed":
			return { action: "agent", transcript: false, often: "week" };
		case "gone":
			return { action: "none" };
	}
}

/** The cron line of How often, at the time of day of the Add source dialog. Null: only now. */
export function oftenCron(often: HowOften): string | null {
	switch (often) {
		case "day":
			return timeAndDaysToCron({ time: READ_AT, days: [0, 1, 2, 3, 4, 5, 6] });
		case "week":
			return timeAndDaysToCron({ time: READ_AT, days: [MONDAY] });
		case "month":
			return "0 6 1 * *";
		case "once":
			return null;
	}
}

/** A source to save (`knowledge.saveSource`), and whether it reads again on its own. */
export type ToldSource = {
	source: KnowledgeSource;
	/** Unset: only now. */
	keepUpToDate?: { cron: string };
};

function withOften(source: KnowledgeSource, often: HowOften): ToldSource {
	const cron = oftenCron(often);
	return cron === null ? { source } : { source, keepUpToDate: { cron } };
}

/**
 * The Web pages source of a link Night Shift reads: the page alone, or with
 * `first` or `all` the pages of its folder, at most as many as the choice
 * says. The crawl stays in the folder.
 */
export function readSource(
	look: LinkLook,
	choice: { much: HowMuch; often: HowOften },
): ToldSource {
	const plan = linkPlan(look);
	const pick =
		plan.action === "read"
			? plan.much?.choices.find((one) => one.much === choice.much)
			: undefined;
	const inputs: Record<string, string> =
		pick && pick.much !== "page" && look.section
			? {
					urls: look.url,
					follow: "true",
					scope: look.section.folder,
					limit: String(pick.pages),
				}
			: { urls: look.url };
	return withOften({ kit: "kit:knowledge/web", inputs }, choice.often);
}

/**
 * The source an agent fills: what the person described, a question that
 * found nothing ("Find it for me"), or a link Night Shift cannot read
 * (`transcript`: the link is video or audio).
 */
export function agentSource(
	what:
		| { text: string }
		| { question: string }
		| { link: string; transcript: boolean },
	often: HowOften,
): ToldSource {
	const described =
		"text" in what
			? what.text.trim()
			: "question" in what
				? `What answers this question: ${what.question.trim()}`
				: what.transcript
					? `The transcript of the video or audio at ${what.link}`
					: `The page at ${what.link}`;
	return withOften(
		{ kit: "kit:knowledge/agent", inputs: { what: described } },
		often,
	);
}
