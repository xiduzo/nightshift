import { convert } from "html-to-text";

/**
 * HTML to plain text with html-to-text: headings, paragraphs and lists keep
 * their lines, a link keeps its address in brackets, and scripts and styles
 * go. No line is wrapped, so a model or a message reads whole paragraphs.
 */
export function htmlToText(html: string): string {
	return convert(html, { wordwrap: false });
}
