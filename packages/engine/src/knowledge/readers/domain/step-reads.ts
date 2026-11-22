import type { PageRead } from "./page-read";

/**
 * What a Command step of a sync flow gets from its page reader (ADR 39):
 * a page's file, or why the page was not read. The listener on this
 * computer answers with it.
 */

/** One read the step asked for. */
export type StepRead =
	/** The step did not give a web address. */
	| { kind: "refused"; reason: string }
	/** How the read went, and the page's file (`read`), nothing (`unchanged`) or why it was not read. */
	| { kind: "answer"; status: PageRead["status"]; body: string };

/** What a step reads when it gives no web address. */
export const NOT_A_PAGE = "Give the page as url=https://…";

/** Whether the step gave a web address. */
export const isPageAddress = (url: string) => /^https?:\/\//i.test(url);

/** How many addresses of a site the step gets at most: 100 when it asks no number, 1 to 5,000. */
export function mapLimit(asked: string | null): number {
	return Math.min(Math.max(Number(asked) || 100, 1), 5_000);
}

/** A page's file in the knowledge: its title and address above its Markdown. */
export function pageFile(
	url: string,
	read: Extract<PageRead, { status: "read" }>,
): string {
	const title = JSON.stringify(read.title.replace(/\s+/g, " ").trim());
	return `---\ntitle: ${title}\nsource: ${url}\n---\n\n${read.markdown.trim()}\n`;
}
