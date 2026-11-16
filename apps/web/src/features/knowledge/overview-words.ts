import type { HowOften } from "@nightshift/client";

const count = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

/**
 * The line under the overview's heading: how much the agents have, and how
 * often what they asked found an answer. With no file yet, how to start.
 */
export function factsLine(facts: {
	files: number;
	sources: number;
	asked: number;
	answered: number;
}): string {
	if (facts.files === 0)
		return "No files yet. Tell a fact or paste a link to start.";
	const files =
		facts.sources > 0
			? `${count(facts.files, "file", "files")} from ${count(facts.sources, "source", "sources")}`
			: count(facts.files, "file", "files");
	return facts.asked > 0
		? `${files} · ${facts.answered} of ${count(facts.asked, "question", "questions")} found an answer`
		: files;
}

/** What one Tell did, for Night Shift's answer in the thread. */
export type TellOutcome = {
	/** The person's words became a note. */
	note: boolean;
	/** How often each source Night Shift reads checks for changes. */
	read: HowOften[];
	/** How many sources an agent fills. */
	agent: number;
	/** The sources started now. False: they wait for their first check. */
	started: boolean;
	/** Links that do not load. */
	gone: number;
	/** Links Night Shift cannot read, and no agent fetches. */
	unread: number;
	/** What did not save, in words for a person. */
	failed: string[];
};

const EVERY: Record<Exclude<HowOften, "once">, string> = {
	day: "every day",
	week: "every week",
	month: "every month",
};

/** Night Shift's answer to a Tell: what it saved, what it reads, and what it left out. */
export function tellReply(outcome: TellOutcome): string {
	const parts: string[] = [];
	if (outcome.note) parts.push("Saved. Agents read it from their next run.");
	const reads = outcome.read.length;
	if (reads > 0) {
		const what = reads === 1 ? "the link" : `the ${reads} links`;
		const when = outcome.started ? "now" : "at the first check";
		const it = reads === 1 ? "it" : "them";
		const kept = outcome.read.filter((often) => often !== "once");
		const [first] = kept;
		const again =
			first === undefined
				? ""
				: kept.every((often) => often === first)
					? ` and checks ${it} for changes ${EVERY[first]}`
					: ` and checks ${it} for changes as you chose`;
		parts.push(`Night Shift reads ${what} ${when}${again}.`);
	}
	if (outcome.agent > 0) {
		parts.push(
			outcome.agent === 1
				? `An agent fetches it ${outcome.started ? "now" : "at the first check"}.`
				: `An agent fetches ${outcome.agent} links ${outcome.started ? "now" : "at the first check"}.`,
		);
		parts.push("What it saves shows under All knowledge.");
	}
	if (outcome.gone > 0) {
		parts.push(
			outcome.gone === 1
				? "One link does not load. Check the address and tell it again."
				: `${outcome.gone} links do not load. Check the addresses and tell them again.`,
		);
	}
	if (outcome.unread > 0) {
		parts.push(
			outcome.unread === 1
				? "Night Shift cannot read one link, so it stays out."
				: `Night Shift cannot read ${outcome.unread} links, so they stay out.`,
		);
	}
	for (const problem of outcome.failed) parts.push(problem);
	return parts.length > 0 ? parts.join(" ") : "Nothing to save.";
}
