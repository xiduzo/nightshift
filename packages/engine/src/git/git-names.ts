import { Refusal } from "@nightshift/refusal";

/**
 * What a git command takes from outside as an argument: the id of an
 * object, a branch by its name, or a revision. Each is checked here before
 * it is an argument, so git reads it as that and nothing else.
 */

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** A character that no name of git holds: a space, a control character, or one git reads in a refspec or a revision. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: a name of git holds none.
const NOT_IN_A_BRANCH = /[\u0000- \u007f~^:?*[\\]/;

/** The full id of a commit or a tree, as git prints it. */
export function objectId(value: unknown): string {
	if (typeof value !== "string" || !OBJECT_ID.test(value)) {
		throw new Refusal("invalid", "That is not the id of a git object.");
	}
	return value;
}

/** The name of a branch (`main`, `nightshift/abcdef12`), by the rules of `git check-ref-format`. */
export function branchName(value: unknown): string {
	if (typeof value !== "string" || !isBranchName(value)) {
		throw new Refusal("invalid", "That is not the name of a branch.");
	}
	return value;
}

function isBranchName(name: string): boolean {
	if (
		name.startsWith("-") ||
		name === "@" ||
		name === "HEAD" ||
		name.endsWith(".")
	)
		return false;
	if (NOT_IN_A_BRANCH.test(name)) return false;
	if (name.includes("..") || name.includes("@{")) return false;
	return name
		.split("/")
		.every(
			(part) => part !== "" && !part.startsWith(".") && !part.endsWith(".lock"),
		);
}

/** Text git reads as a revision: a branch, a tag, a commit, `HEAD~1`. */
export function revision(value: unknown): string {
	if (
		typeof value !== "string" ||
		value === "" ||
		value.startsWith("-") ||
		value.includes("\0")
	) {
		throw new Refusal("invalid", "That is not a branch or a commit.");
	}
	return value;
}
