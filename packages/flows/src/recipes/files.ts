/**
 * The awk that turns one path per line into a JSON array of list items,
 * `{ id: path, title: path, path }`, with `\` and `"` escaped.
 */
const PATHS_TO_ITEMS = `awk 'BEGIN { printf "[" } { gsub(/\\\\/, "\\\\\\\\"); gsub(/"/, "\\\\\\""); printf "%s{\\"id\\":\\"%s\\",\\"title\\":\\"%s\\",\\"path\\":\\"%s\\"}", (NR > 1 ? "," : ""), $0, $0, $0 } END { print "]" }'`;

/**
 * A source command that prints the files of the worktree that match a
 * glob, sorted by path, as list items `{ id: path, title: path, path }`:
 * what the old `files` source read. `git ls-files` lists the tracked files
 * and the new ones that git does not ignore. In the glob, `*` stays within
 * one folder and `**` crosses folders. The glob may hold templates, for
 * example `{{glob}}`: the command adapter passes them as environment
 * variables, inside the double quotes.
 */
export function gitFilesCommand(glob: string): string {
	return [
		`git ls-files -z --cached --others --exclude-standard -- ":(glob)${shellQuoted(glob)}" \\`,
		`  | tr '\\000' '\\n' | LC_ALL=C sort -u \\`,
		`  | ${PATHS_TO_ITEMS}`,
	].join("\n");
}

/** Text inside a double-quoted shell argument: `\`, `"`, `$` and a backtick escaped. */
function shellQuoted(text: string): string {
	return text.replace(/[\\"$`]/g, (char) => `\\${char}`);
}
