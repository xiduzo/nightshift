/**
 * The initials of a name, for an avatar: "Sam Boer" → "SB", "website" →
 * "WE", "api-server" → "AS". Two letters at most, upper case. "?" for an
 * empty name.
 */
export function initialsOf(name: string): string {
	const words = name
		.trim()
		.split(/[\s\-_./]+/)
		.filter((word) => /[\p{L}\p{N}]/u.test(word));
	const first = words[0];
	if (!first) return "?";
	const letters = (word: string) => [...word.replace(/[^\p{L}\p{N}]/gu, "")];
	const second = words[1];
	const picked = second
		? [letters(first)[0], letters(second)[0]]
		: letters(first).slice(0, 2);
	return picked.join("").toLocaleUpperCase();
}
