/**
 * The links in a Gate's question, so the inbox can show them beside the
 * context: a pull request, a ticket, a page to check before answering.
 */
export type GateLink = {
	url: string;
	/** What the flow called it ("Draft pull request"), or a name from the URL. */
	label: string;
	/** Short form: "#7515", "PZ-12908", "example.com". */
	short: string;
	/** Where it lives: "infonl/dimpact-zaakafhandelcomponent", "github.com". */
	where: string;
	kind: "pull" | "issue" | "ticket" | "web";
};

const URL_PATTERN = /https?:\/\/[^\s<>()"'`\]]+/g;
/** A line that holds only a link: `Draft pull request: https://…`, `- https://…`. */
const LINK_LINE = /^\s*(?:[-*]\s*)?(?:([^\n:]{1,48}):\s*)?(https?:\/\/\S+)\s*$/;
/** A Jira-style key in a path: `/browse/PZ-12908`. */
const TICKET_PATH = /\/browse\/([A-Z][A-Z0-9]+-\d+)/;

/** Sentence punctuation after a URL is not part of it. */
function trimUrl(raw: string): string {
	return raw.replace(/[.,;:!?)]+$/, "");
}

export function describeLink(url: string, label: string | null): GateLink {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { url, label: label ?? url, short: url, where: "", kind: "web" };
	}
	const host = parsed.hostname.replace(/^www\./, "");
	const parts = parsed.pathname.split("/").filter(Boolean);

	const [owner, repo, type, number] = parts;
	if (host === "github.com" && (type === "pull" || type === "issues")) {
		const kind = type === "pull" ? "pull" : "issue";
		return {
			url,
			label: label ?? (kind === "pull" ? "Pull request" : "Issue"),
			short: `#${number}`,
			where: `${owner}/${repo}`,
			kind,
		};
	}
	const ticket = TICKET_PATH.exec(parsed.pathname)?.[1];
	if (ticket) {
		return {
			url,
			label: label ?? "Ticket",
			short: ticket,
			where: host,
			kind: "ticket",
		};
	}
	return {
		url,
		label: label ?? (parts.at(-1) || host),
		short: host,
		where: host,
		kind: "web",
	};
}

/**
 * The links in a question, in order, once each, and the question without the
 * lines that held only a link. A link inside a sentence stays in the text and
 * is listed too.
 */
export function extractGateLinks(question: string): {
	links: GateLink[];
	question: string;
} {
	const links = new Map<string, GateLink>();
	const kept: string[] = [];
	let fenced = false;
	for (const line of question.split("\n")) {
		// Code keeps its text: a URL in a diff is not a link to check.
		if (line.trimStart().startsWith("```")) fenced = !fenced;
		if (fenced || line.trimStart().startsWith("```")) {
			kept.push(line);
			continue;
		}
		const only = LINK_LINE.exec(line);
		if (only?.[2]) {
			const url = trimUrl(only[2]);
			if (!links.has(url)) links.set(url, describeLink(url, only[1] ?? null));
			continue;
		}
		for (const match of line.matchAll(URL_PATTERN)) {
			const url = trimUrl(match[0]);
			if (!links.has(url)) links.set(url, describeLink(url, null));
		}
		kept.push(line);
	}
	return {
		links: [...links.values()],
		question: kept.join("\n").replace(/\n{3,}/g, "\n\n"),
	};
}
