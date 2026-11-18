import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** Nodes whose children run on in one line: no space between them. */
const INLINE = new Set<Nodes["type"]>([
	"emphasis",
	"strong",
	"delete",
	"link",
	"linkReference",
	"paragraph",
	"heading",
	"tableCell",
]);

/**
 * Markdown as one line of plain text, for a place that cannot render it: a
 * notification, a tab title, an accessibility label, a row on the phone.
 * `**Ship** the [fix](https://x)?` becomes `Ship the fix?`. Marks of
 * emphasis, strike and code go, a link keeps its text, an image its alt
 * text, and heading, list and quote marks go. Whitespace folds into one
 * space. Parsed as GitHub Markdown, the way the web renders it.
 */
export function plainText(markdown: string): string {
	const tree = fromMarkdown(markdown, {
		extensions: [gfm()],
		mdastExtensions: [gfmFromMarkdown()],
	});
	return textOf(tree).replace(/\s+/g, " ").trim();
}

function textOf(node: Nodes): string {
	switch (node.type) {
		case "text":
		case "inlineCode":
		case "code":
		// Raw HTML stays as text, as on the web: `Merge <branch>?`.
		case "html":
			return node.value;
		case "image":
		case "imageReference":
			return node.alt ?? "";
		case "break":
			return " ";
	}
	if (!("children" in node)) return "";
	const parts = (node.children as Nodes[]).map(textOf);
	return parts.join(INLINE.has(node.type) ? "" : " ");
}
