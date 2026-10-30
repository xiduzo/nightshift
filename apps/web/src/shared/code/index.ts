/** Code and JSON in a shadcn code block, and code to edit, highlighted by Shiki. */

export { CodeTextarea } from "./code-textarea";
export { DiffLines, type DiffLineVariant } from "./diff-line";
export { formatJson } from "./format-json";
export {
	CODE_LANGUAGES,
	type CodeLanguage,
	guessLanguage,
	languageOfPath,
} from "./guess-language";
export { CodeView, JsonBlock, JsonDetails } from "./json-block";
