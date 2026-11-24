const PATHS_TO_ITEMS = `awk 'BEGIN { printf "[" } { gsub(/\\\\/, "\\\\\\\\"); gsub(/"/, "\\\\\\""); printf "%s{\\"id\\":\\"%s\\",\\"title\\":\\"%s\\",\\"path\\":\\"%s\\"}", (NR > 1 ? "," : ""), $0, $0, $0 } END { print "]" }'`;

export function gitFilesCommand(glob: string): string {
	return [
		`git ls-files -z --cached --others --exclude-standard -- ":(glob)${shellQuoted(glob)}" \\`,
		`  | tr '\\000' '\\n' | LC_ALL=C sort -u \\`,
		`  | ${PATHS_TO_ITEMS}`,
	].join("\n");
}

function shellQuoted(text: string): string {
	return text.replace(/[\\"$`]/g, (char) => `\\${char}`);
}
