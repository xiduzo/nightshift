/**
 * The language of a file for highlighting, from its extension ("kt",
 * "ts"): the highlighter maps an extension to its language. A file without
 * an extension is plain text.
 */
export function languageOfPath(path: string): string {
	const name = path.split("/").at(-1) ?? "";
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : "text";
}

/** The languages a code field can show, in the order a picker lists them. */
export const CODE_LANGUAGES = [
	{ value: "markdown", label: "Markdown" },
	{ value: "bash", label: "Shell" },
	{ value: "json", label: "JSON" },
	{ value: "yaml", label: "YAML" },
	{ value: "typescript", label: "TypeScript" },
	{ value: "javascript", label: "JavaScript" },
	{ value: "python", label: "Python" },
	{ value: "text", label: "Plain text" },
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]["value"];

type Guessed = Exclude<CodeLanguage, "text" | "javascript">;

// Lines that point to a language. A line can count for more than one.
const SIGNS: Record<Exclude<Guessed, "json">, RegExp[]> = {
	markdown: [
		/^#{1,6} \S/,
		/^\s*[-*+] \S/,
		/^\s*\d+\. \S/,
		/^\s*```/,
		/\*\*[^*\n]+\*\*/,
		/\[[^\]\n]+\]\([^)\n]+\)/,
	],
	bash: [
		/^\s*(echo|cd|export|set -\w|if \[|fi|then|done|do|esac|mkdir|rm|cp|mv|cat|grep|sed|awk|curl|git|gh|bun|bunx|npm|npx|pnpm|yarn|make|sudo|test|exit)\b/,
		/\$\{?\w+/,
		/\$\(/,
		/ \| /,
		/&&|\|\|/,
		/ [12]?>&?\S/,
	],
	typescript: [
		/^\s*(import|export) .*\bfrom ['"]/,
		/^\s*(export )?(const|let|var) \w+(: [^=]+)? =/,
		/=> ?[{(\w]/,
		/^\s*(export )?(interface|type) \w+/,
		/^\s*(export )?(async )?function\*? ?\w*\(/,
		/\bawait \w/,
	],
	python: [
		/^\s*(async )?def \w+\(.*\):\s*$/,
		/^\s*(from [\w.]+ )?import [\w.]+(, [\w.]+)*\s*$/,
		/^\s*(if|elif|else|for|while|with|try|except|class)\b.*:\s*$/,
		/\bprint\(/,
		/\bself\./,
	],
	yaml: [/^\s*(- )?[\w-]+:( \S.*)?$/, /^\s*- \S/, /^---\s*$/],
};

/**
 * The language that the code looks like, or null when nothing stands out.
 * A shebang or a JSON value decides. Otherwise the language with the most
 * lines that point to it wins.
 */
export function guessLanguage(code: string): Guessed | null {
	const text = code.trim();
	if (text === "") return null;

	const shebang = /^#!.*\b(bash|zsh|sh|python3?|node|bun|deno|tsx)\b/.exec(
		text,
	)?.[1];
	if (shebang) {
		if (shebang.startsWith("python")) return "python";
		if (/node|bun|deno|tsx/.test(shebang)) return "typescript";
		return "bash";
	}

	if (/^[[{]/.test(text)) {
		try {
			// A template stands for any value.
			JSON.parse(text.replace(/\{\{[^{}]*\}\}/g, "0"));
			return "json";
		} catch {}
	}

	const lines = text.split("\n").filter((line) => line.trim() !== "");
	const scores = Object.entries(SIGNS).map(([language, signs]) => ({
		language: language as Guessed,
		score: lines.filter((line) => signs.some((sign) => sign.test(line))).length,
	}));
	// Plain sentences such as "Note: read this" look like YAML, so YAML needs
	// most of the lines.
	const yaml = scores.find((entry) => entry.language === "yaml");
	if (yaml && (lines.length < 2 || yaml.score < lines.length * 0.8))
		yaml.score = 0;

	scores.sort((a, b) => b.score - a.score);
	const [best, next] = scores;
	if (!best || best.score === 0 || best.score === next?.score) return null;
	// One line in a long text is chance.
	if (best.score < Math.min(2, lines.length)) return null;
	return best.language;
}
