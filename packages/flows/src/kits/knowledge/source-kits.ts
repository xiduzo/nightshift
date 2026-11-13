import { z } from "zod";
import { KNOWLEDGE_STAGING_SUFFIX } from "./layout";
import { defineSyncKit, type SourceKind } from "./sync-kit";
import { WEB_SOURCE } from "./web-source";

/**
 * Every Knowledge source Night Shift ships, one declaration each, in the
 * order the page offers them. A new source is one more entry here: the
 * kit list, the kinds and the page all derive from this list.
 */

/** The most files one sync of a folder copies: more is rarely knowledge. */
const FOLDER_MAX_FILES = 5000;

/** The secret the Confluence kit reads: an Atlassian API token. */
const CONFLUENCE_TOKEN = "CONFLUENCE_API_TOKEN";

/**
 * Jira's description (Atlassian Document Format) as plain text, and a work
 * item as one markdown file. No single quotes: it goes in `jq '…'`.
 */
const WORK_ITEM_MARKDOWN = String.raw`def adf: if type == "string" then . elif type == "array" then map(adf) | join("") elif type == "object" then (if .type == "text" then .text elif .type == "hardBreak" then "\n" else ((.content // []) | map(adf) | join("")) + (if (.type == "paragraph" or .type == "heading" or .type == "codeBlock" or .type == "blockquote" or .type == "listItem") then "\n\n" else "" end) end) else "" end; "# \(.key): \(.fields.summary // "")\n\nType: \(.fields.issuetype.name // "")\nStatus: \(.fields.status.name // "")\n\n\(.fields.description | adf)"`;

/**
 * A Confluence page (its storage format) as rough markdown: headings, list
 * items and line breaks kept, every other tag dropped. No single quotes:
 * it goes in `jq '…'`.
 */
const PAGE_MARKDOWN = String.raw`"# \(.title)\n\n" + ((.body.storage.value // "") | gsub("<h[1-6][^>]*>"; "\n## ") | gsub("<li[^>]*>"; "- ") | gsub("</(p|h[1-6]|li|tr|div|ul|ol|table|pre)>|<br ?/?>"; "\n") | gsub("<[^>]+>"; "") | gsub("&nbsp;"; " ") | gsub("&lt;"; "<") | gsub("&gt;"; ">") | gsub("&quot;"; "\"") | gsub("&amp;"; "&"))`;

/** The kits of the sources, in the order the page offers them. */
export const KNOWLEDGE_SYNC_KITS = [
	/**
	 * A folder anywhere on the computer, such as notes or specs that live
	 * outside any repository. A folder exists on one computer only: run the
	 * sync there. Hidden files and folders stay out. It replaces what the
	 * folder had.
	 */
	defineSyncKit({
		name: "folder",
		label: "Folder on this computer",
		blurb: "Notes or documents outside this project.",
		flowName: "knowledge-folder",
		main: "path",
		lines: ["patterns"],
		local: true,
		programs: [],
		description:
			"Copies a folder of this computer into the project's knowledge, such as notes outside the project. It replaces what the folder had.",
		inputs: [
			{
				name: "path",
				label: "Folder",
				type: "text",
				description:
					"The full path of the folder, for example ~/notes or /Users/you/specs.",
				required: true,
			},
			{
				name: "patterns",
				label: "Files",
				type: "text",
				description:
					"Which files to copy, one pattern per line, for example *.md. Empty copies every file.",
			},
		],
		folder: "folder",
		stepLabel: "Copy the folder",
		script: String.raw`src="{{path}}"
case "$src" in
	"~") src="$HOME" ;;
	"~/"*) src="$HOME/$(printf '%s' "$src" | cut -c3-)" ;;
esac
case "$src" in
	/*) ;;
	*) echo "Enter the full path of the folder, for example ~/notes." >&2; exit 2 ;;
esac
if [ ! -d "$src" ]; then
	echo "This computer has no folder $src." >&2
	exit 3
fi
patterns="{{patterns}}"
part="$dest${KNOWLEDGE_STAGING_SUFFIX}"
list=$(mktemp)
trap 'rm -rf "$part" "$list"' EXIT
rm -rf "$part"
mkdir -p "$part"
cd "$src"
# Split the patterns, but never expand one here: find matches them.
set -f
if [ -z "$patterns" ]; then
	find . -type f -not -path '*/.*' | sed 's#^\./##' > "$list"
else
	for pattern in $patterns; do
		pattern=$(printf '%s' "$pattern" | sed 's#^\./##')
		find . -type f -not -path '*/.*' \( -path "./$pattern" -o -path "./$pattern/*" \) | sed 's#^\./##' >> "$list"
	done
fi
sort -u -o "$list" "$list"
count=$(wc -l < "$list" | tr -d ' ')
if [ "$count" -eq 0 ]; then
	echo "No files in $src match: $patterns" >&2
	exit 3
fi
if [ "$count" -gt ${FOLDER_MAX_FILES} ]; then
	echo "$src has $count files. Copy at most ${FOLDER_MAX_FILES}: choose a smaller folder, or patterns." >&2
	exit 4
fi
while IFS= read -r rel; do
	mkdir -p "$part/$(dirname "$rel")"
	cp -p "$rel" "$part/$rel"
done < "$list"
rm -rf "$dest"
mv "$part" "$dest"`,
		messages: {
			synced: "Folder copied",
			notSynced: "Could not copy the folder",
		},
		stops: [
			{
				outcome: "nothing",
				code: 3,
				end: "nothing_found",
				message: "No files to copy in {{path}}",
			},
			{
				outcome: "too-many",
				code: 4,
				end: "too_many_files",
				message: `{{path}} has more than ${FOLDER_MAX_FILES} files`,
			},
		],
	}),

	/**
	 * Files of the project's own folder. The run's copy of the project has
	 * only what git tracks, so the paths are read in the project's folder
	 * itself: files git ignores, such as `docs/private/`, become knowledge
	 * without a commit.
	 */
	defineSyncKit({
		name: "files",
		label: "Project files",
		blurb: "Files of this project, also the ones git ignores.",
		flowName: "knowledge-project-files",
		main: "from",
		lines: ["from"],
		needsFolder: true,
		programs: [],
		description:
			"Copies files of the project into its knowledge, also files that git ignores, such as private notes. It replaces what the folder had.",
		inputs: [
			{
				name: "from",
				label: "What to copy",
				type: "text",
				description:
					"What to copy, one path or pattern per line, in the project's folder: docs/private or notes/*.md.",
				required: true,
			},
		],
		folder: "files",
		stepLabel: "Copy the files",
		script: String.raw`# The project's own folder: the run works in a copy that has only what git tracks.
common=$(git rev-parse --git-common-dir)
case "$common" in /*) ;; *) common="$PWD/$common" ;; esac
project=$(cd "$common/.." && pwd)
from="{{from}}"
part="$dest${KNOWLEDGE_STAGING_SUFFIX}"
rm -rf "$part"
mkdir -p "$part"
cd "$project"
found=0
IFS='
'
for src in $from; do
	[ -e "$src" ] || continue
	rel=$(printf '%s' "$src" | sed 's#^/*##')
	mkdir -p "$part/$(dirname "$rel")"
	cp -R "$src" "$part/$rel"
	found=$((found + 1))
done
if [ "$found" -eq 0 ]; then
	rm -rf "$part"
	echo "Nothing in the project's folder matches: $from" >&2
	exit 3
fi
rm -rf "$dest"
mv "$part" "$dest"`,
		messages: {
			synced: "Files copied",
			notSynced: "Could not copy the files",
		},
		stops: [
			{
				outcome: "nothing",
				code: 3,
				end: "nothing_found",
				message: "No files match {{from}}",
			},
		],
	}),

	/** Web pages as markdown, also the pages they link to: `web-source.ts`. */
	WEB_SOURCE,

	/**
	 * The wiki of a GitHub repository, with plain git. The first sync clones
	 * it, a later one takes the newest pages. A private wiki needs git signed
	 * in to GitHub.
	 */
	defineSyncKit({
		name: "github-wiki",
		label: "GitHub wiki",
		blurb: "The wiki of a repository, also a private one.",
		flowName: "knowledge-github-wiki",
		main: "repo",
		lines: [],
		programs: [],
		description:
			"Copies the wiki of a GitHub repository into the project's knowledge, and takes the newest pages on each later sync. A private wiki needs git signed in to GitHub.",
		inputs: [
			{
				name: "repo",
				label: "Repository",
				type: "text",
				description:
					"The repository, for example owner/name. Or the git address of any wiki.",
				required: true,
			},
		],
		folder: "wiki",
		stepLabel: "Sync the wiki",
		script: String.raw`repo="{{repo}}"
case "$repo" in
	*://*|*@*) url="$repo" ;;
	*) url="https://github.com/$repo.wiki.git" ;;
esac
if [ -d "$dest/.git" ]; then
	git -C "$dest" fetch -q --depth 1 "$url"
	git -C "$dest" reset -q --hard FETCH_HEAD
else
	rm -rf "$dest"
	mkdir -p "$NS_KNOWLEDGE"
	git clone -q --depth 1 "$url" "$dest"
fi`,
		messages: {
			synced: "Wiki synced",
			notSynced: "Could not sync the wiki",
		},
	}),

	/**
	 * Some folders or files of any git repository, such as the markdown of
	 * a documentation site. The clone is shallow, blobless and sparse: git
	 * fetches the contents of only the files that match the patterns
	 * (non-cone sparse-checkout, gitignore syntax). A later sync fetches the
	 * newest commit and applies the patterns again, so a file that no
	 * longer matches leaves the folder. Another repository clones anew.
	 */
	defineSyncKit({
		name: "git",
		label: "Git repository",
		blurb: "Only the folders or files you choose, such as the docs.",
		flowName: "knowledge-git",
		main: "repo",
		lines: ["paths"],
		programs: [],
		description:
			"Copies the folders or files you choose of a git repository into the project's knowledge. Each later sync takes the newest version. A private repository needs git signed in.",
		inputs: [
			{
				name: "repo",
				label: "Repository",
				type: "text",
				description:
					"The repository, for example owner/name on GitHub. Or the git address of any repository.",
				required: true,
			},
			{
				name: "branch",
				label: "Branch",
				type: "text",
				description: "Empty takes the main branch of the repository.",
			},
			{
				name: "paths",
				label: "Only these paths",
				type: "text",
				description:
					"Git patterns, one per line, for example docs/**/*.md. Start a line with ! to leave paths out. Empty copies everything.",
			},
		],
		folder: "repo",
		stepLabel: "Sync the repository",
		script: String.raw`repo="{{repo}}"
branch="{{branch}}"
paths="{{paths}}"
case "$repo" in
	*://*|*@*) url="$repo" ;;
	*) url="https://github.com/$repo.git" ;;
esac
# Shallow and blobless: git fetches a file's contents only when the patterns check it out.
if [ -d "$dest/.git" ] && [ "$(git -C "$dest" remote get-url origin 2>/dev/null)" = "$url" ]; then
	if [ -n "$branch" ]; then
		git -C "$dest" fetch -q --depth 1 --filter=blob:none origin "$branch"
	else
		git -C "$dest" fetch -q --depth 1 --filter=blob:none origin HEAD
	fi
	commit=FETCH_HEAD
else
	rm -rf "$dest"
	mkdir -p "$NS_KNOWLEDGE"
	if [ -n "$branch" ]; then
		git clone -q --depth 1 --filter=blob:none --no-checkout --branch "$branch" "$url" "$dest"
	else
		git clone -q --depth 1 --filter=blob:none --no-checkout "$url" "$dest"
	fi
	commit=HEAD
fi
# The patterns may have changed since the last sync: apply them again.
patterns=$(printf '%s\n' "$paths" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d')
if [ -z "$patterns" ]; then
	git -C "$dest" sparse-checkout disable
else
	printf '%s\n' "$patterns" | git -C "$dest" sparse-checkout set --no-cone --stdin
fi
git -C "$dest" reset -q --hard "$commit"
if [ -z "$(find "$dest" -type f -not -path "$dest/.git/*" | head -n 1)" ]; then
	echo "No files of $repo match: $patterns" >&2
	exit 3
fi`,
		messages: {
			synced: "Repository synced",
			notSynced: "Could not sync the repository",
		},
		stops: [
			{
				outcome: "nothing",
				code: 3,
				end: "nothing_found",
				message: "No files of {{repo}} match the paths",
			},
		],
	}),

	/** Jira work items as markdown, with the Atlassian CLI (`acli`) and `jq`. */
	defineSyncKit({
		name: "jira",
		label: "Jira",
		blurb: "Work items, through your Jira CLI tool. You must be signed in.",
		flowName: "knowledge-jira",
		main: "keys",
		lines: ["keys"],
		programs: [
			{
				name: "jq",
				why: "this kit turns the work items into markdown with it",
			},
		],
		description:
			"Copies Jira work items into the project's knowledge as markdown, one file each. Needs a CLI tool that runs the Atlassian CLI signed in, and jq.",
		inputs: [
			{
				name: "keys",
				label: "Work items",
				type: "text",
				description:
					"The work items, separated by spaces, commas or lines, for example PROJ-1, PROJ-2.",
				required: true,
			},
			{
				name: "tool",
				label: "CLI tool",
				type: "text",
				description:
					"The CLI tool that runs acli signed in, for example acli-work. Each CLI tool with a login is one account.",
				default: "acli",
			},
		],
		folder: "jira",
		stepLabel: "Copy the work items",
		script: String.raw`tool="{{tool}}"
keys="{{keys}}"
mkdir -p "$dest"
# Split the list, but never read a pattern in it.
set -f
for key in $(printf '%s' "$keys" | tr ',' ' '); do
	"$tool" jira workitem view "$key" --json > "$dest/$key.json${KNOWLEDGE_STAGING_SUFFIX}"
	jq -r '${WORK_ITEM_MARKDOWN}' "$dest/$key.json${KNOWLEDGE_STAGING_SUFFIX}" > "$dest/$key.md"
	rm -f "$dest/$key.json${KNOWLEDGE_STAGING_SUFFIX}"
done`,
		messages: {
			synced: "Work items synced",
			notSynced: "Could not sync the work items",
		},
	}),

	/**
	 * Confluence pages as markdown, with `curl` on the REST API and `jq`. The
	 * API token is a secret the command reads.
	 */
	defineSyncKit({
		name: "confluence",
		label: "Confluence",
		blurb: "Pages by id, with an API token you save as a secret.",
		flowName: "knowledge-confluence",
		main: "pages",
		lines: ["pages"],
		programs: [
			{ name: "curl" },
			{ name: "jq", why: "this kit turns the pages into markdown with it" },
		],
		description: `Copies Confluence pages into the project's knowledge as markdown, one file each. Save an Atlassian API token as the secret ${CONFLUENCE_TOKEN}. Needs jq.`,
		inputs: [
			{
				name: "site",
				label: "Site",
				type: "text",
				description:
					"Your Confluence site, for example your-team.atlassian.net.",
				required: true,
			},
			{
				name: "email",
				label: "Email",
				type: "text",
				description: "The email address of the account the API token is of.",
				required: true,
			},
			{
				name: "pages",
				label: "Pages",
				type: "text",
				description:
					"The page ids, separated by spaces, commas or lines. The id is the number in the address of the page.",
				required: true,
			},
		],
		folder: "confluence",
		stepLabel: "Copy the pages",
		secrets: [CONFLUENCE_TOKEN],
		script: String.raw`site=$(printf '%s' "{{site}}" | sed -e 's#^[A-Za-z]*://##' -e 's#/.*$##')
email="{{email}}"
pages="{{pages}}"
mkdir -p "$dest"
# Split the list, but never read a pattern in it.
set -f
for id in $(printf '%s' "$pages" | tr ',' ' '); do
	curl -fsS --max-time 120 -u "$email:$${CONFLUENCE_TOKEN}" -H "Accept: application/json" "https://$site/wiki/api/v2/pages/$id?body-format=storage" > "$dest/$id.json${KNOWLEDGE_STAGING_SUFFIX}"
	jq -r '${PAGE_MARKDOWN}' "$dest/$id.json${KNOWLEDGE_STAGING_SUFFIX}" > "$dest/$id.md"
	rm -f "$dest/$id.json${KNOWLEDGE_STAGING_SUFFIX}"
done`,
		messages: {
			synced: "Pages synced",
			notSynced: "Could not sync the pages",
		},
	}),
];

/** The kit of a source. */
export type KnowledgeSourceKit = (typeof KNOWLEDGE_SYNC_KITS)[number]["kit"];

export const knowledgeSourceKitSchema = z.enum(
	KNOWLEDGE_SYNC_KITS.map(({ kit }) => kit) as [
		KnowledgeSourceKit,
		...KnowledgeSourceKit[],
	],
);

/** One kind of source, as the page shows it and a new flow is named. */
type KnowledgeSourceKind = SourceKind<KnowledgeSourceKit>;

/** Every kind of source, in the order the page offers them. */
export const KNOWLEDGE_SOURCE_KINDS: readonly KnowledgeSourceKind[] =
	KNOWLEDGE_SYNC_KITS.map(({ kind }) => kind);

/**
 * The kind of a kit: always there for a source's kit, undefined for any
 * other name a flow calls.
 */
export function knowledgeSourceKind(
	kit: KnowledgeSourceKit,
): KnowledgeSourceKind;
export function knowledgeSourceKind(
	kit: string,
): KnowledgeSourceKind | undefined;
export function knowledgeSourceKind(
	kit: string,
): KnowledgeSourceKind | undefined {
	return KNOWLEDGE_SOURCE_KINDS.find((kind) => kind.kit === kit);
}
