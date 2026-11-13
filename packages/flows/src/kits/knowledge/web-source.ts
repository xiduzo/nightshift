import { KNOWLEDGE_STAGING_SUFFIX } from "./layout";
import { defineSyncKit } from "./sync-kit";

/**
 * The Web pages source: pages as markdown, through the free reader at
 * r.jina.ai. No account. A page that cannot be read keeps its last copy and
 * does not stop the others: the sync fails only when it reads no page at
 * all. The reader answers 200 for a page that is gone or behind a bot
 * check, and says so in a `Warning:` line above the content.
 *
 * With `follow`, the given pages are where a crawl starts:
 *
 * - Scope: only addresses that start with a line of `scope`, else with the
 *   folder of a given page (`https://example.com/docs/`).
 * - Sitemap first: the `Sitemap:` lines of the site's robots.txt, else
 *   `<origin>/sitemap.xml` (one level of sitemap index, at most
 *   {@link WEB_MAX_SITEMAPS} files). When it lists pages in scope, the sync
 *   reads those and follows no link. Otherwise it follows the links of the
 *   markdown, breadth first, to `depth` links away.
 * - A link loses its `#fragment` and its `?query`, and two addresses with
 *   the same file name are one page. Images, media, fonts, archives, code,
 *   feeds and PDFs are not pages: a PDF can be a start page, but a crawl
 *   does not follow it (the reader turns it into one long file).
 * - robots.txt: the `Disallow` lines of the `User-agent: *` group, read as
 *   address prefixes (a `*` ends the prefix, a final `$` is dropped).
 *   `Allow` lines do not lift them: the sync reads less, never more.
 * - One request at a time, `NS_WEB_PAUSE` seconds apart (default 3: the
 *   reader takes 20 requests a minute without a key), with a User-Agent
 *   that names Night Shift, not the person.
 * - At most `limit` pages (default 100, never more than
 *   {@link WEB_MAX_PAGES}).
 * - A page that left the crawl leaves the folder, but only after a whole
 *   crawl: not when the page limit cut it, not when it read no page, and
 *   not when a page it followed links from could not be read (the pages
 *   below it are unknown). A sitemap crawl lists every page, so a page that
 *   could not be read there keeps its copy and removes nothing else.
 * - Every later sync reads every page again. A sitemap `lastmod` would
 *   skip unchanged pages, but sites set it unreliably, and the reader
 *   gives no cheap change check.
 *
 * `NS_WEB_READER` sets the reader's address (default `https://r.jina.ai/`):
 * tests point it at a local server.
 */

/** The most pages one sync of a crawl reads, whatever the source says. */
const WEB_MAX_PAGES = 500;

/** The most sitemap files one crawl reads, sitemap indexes included. */
const WEB_MAX_SITEMAPS = 20;

/** The User-Agent of every request: it names the product, never the person. */
const WEB_USER_AGENT =
	"NightShift-knowledge/1 (+https://github.com/xiduzo/nightshift)";

/**
 * Addresses that are no page: a crawl does not follow them. Lower case,
 * as a `case` pattern.
 */
const NOT_PAGES = [
	"png",
	"jpg",
	"jpeg",
	"gif",
	"svg",
	"webp",
	"avif",
	"ico",
	"bmp",
	"tif",
	"tiff",
	"mp3",
	"mp4",
	"m4a",
	"mov",
	"webm",
	"wav",
	"ogg",
	"avi",
	"zip",
	"gz",
	"tgz",
	"tar",
	"rar",
	"7z",
	"dmg",
	"exe",
	"pkg",
	"deb",
	"rpm",
	"css",
	"js",
	"mjs",
	"json",
	"xml",
	"rss",
	"atom",
	"woff",
	"woff2",
	"ttf",
	"otf",
	"eot",
	"pdf",
]
	.map((extension) => `*.${extension}`)
	.join("|");

/**
 * The shell of the sync. No `$` followed by `{` in it: that would be a
 * template of this string.
 */
const WEB_SCRIPT = String.raw`urls="{{urls}}"
follow="{{follow}}"
scope="{{scope}}"
limit="{{limit}}"
depth="{{depth}}"
reader="$NS_WEB_READER"
[ -n "$reader" ] || reader="https://r.jina.ai/"
pause="$NS_WEB_PAUSE"
case "$pause" in ""|*[!0-9]*) pause=3 ;; esac
agent="${WEB_USER_AGENT}"
mkdir -p "$dest"
# Split the list, but never read a pattern in it.
set -f
# The file name of an address: two addresses with one name are one page.
name_of() {
	printf '%s' "$1" | sed -e 's#^[A-Za-z]*://##' -e 's#[/?=&:]#-#g' -e 's#[^A-Za-z0-9._-]##g' -e 's#-*$##'
}
requests=0
# Reads page $1 through the reader into $dest/$name.md. Fails, and keeps the last copy, when the page cannot be read.
read_page() {
	if [ "$requests" -gt 0 ] && [ "$pause" -gt 0 ]; then sleep "$pause"; fi
	requests=$((requests + 1))
	part="$dest/$name.md${KNOWLEDGE_STAGING_SUFFIX}"
	if ! curl -fsL --max-time 120 -A "$agent" "$reader$1" > "$part"; then
		echo "Could not read $1: the page did not load." >&2
	elif sed -n '1,/^Markdown Content:/p' "$part" | grep -q -E '^Warning: (Target URL returned error|This page maybe requiring CAPTCHA)'; then
		echo "Could not read $1: the page is gone or blocks readers." >&2
	else
		mv "$part" "$dest/$name.md"
		return 0
	fi
	rm -f "$part"
	return 1
}
if [ "$follow" != "true" ]; then
	kept=0
	missed=""
	for url in $urls; do
		name=$(name_of "$url")
		if read_page "$url"; then
			kept=$((kept + 1))
		else
			missed="$missed $url"
		fi
	done
	if [ "$kept" -eq 0 ]; then exit 1; fi
	skipped=""
	if [ -n "$missed" ]; then
		skipped=$(printf '. Could not read:%s' "$missed" | sed -e 's/[\\"]/\\&/g')
	fi
else
case "$limit" in ""|*[!0-9]*) limit=100 ;; esac
case "$limit" in ????*) limit=${WEB_MAX_PAGES} ;; esac
if [ "$limit" -gt ${WEB_MAX_PAGES} ]; then limit=${WEB_MAX_PAGES}; fi
if [ "$limit" -lt 1 ]; then limit=1; fi
case "$depth" in ""|*[!0-9]*) depth=3 ;; esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
for file in queue seen scopes blocked origins listed mapped crawled; do : > "$work/$file"; done
# An address without its #fragment and ?query.
clean() {
	printf '%s' "$1" | sed -e 's/#.*//' -e 's/?.*//'
}
origin_of() {
	printf '%s' "$1" | sed -n 's|^\([A-Za-z]*://[^/?#]*\).*|\1|p'
}
# The folder of an address: https://example.com/docs/intro gives https://example.com/docs/.
folder_of() {
	if printf '%s' "$1" | grep -q '^[A-Za-z]*://[^/]*/'; then
		printf '%s' "$1" | sed 's#[^/]*$##'
	else
		printf '%s/' "$1"
	fi
}
blocked() {
	while IFS= read -r prefix; do
		case "$1" in "$prefix"*) return 0 ;; esac
	done < "$work/blocked"
	return 1
}
# A page the crawl reads: under a scope, not an image or a file, not refused by robots.txt.
wanted() {
	case "$(printf '%s' "$1" | tr 'A-Z' 'a-z')" in
		http://*|https://*) ;;
		*) return 1 ;;
	esac
	case "$(printf '%s' "$1" | tr 'A-Z' 'a-z')" in ${NOT_PAGES}) return 1 ;; esac
	in_scope=1
	while IFS= read -r prefix; do
		case "$1" in "$prefix"*) in_scope=0 ;; esac
		case "$1/" in "$prefix") in_scope=0 ;; esac
	done < "$work/scopes"
	[ "$in_scope" -eq 0 ] || return 1
	! blocked "$1"
}
enqueue() {
	name=$(name_of "$2")
	if [ -z "$name" ] || grep -qxF "$name" "$work/seen"; then return 0; fi
	printf '%s\n' "$name" >> "$work/seen"
	printf '%s %s\n' "$1" "$2" >> "$work/queue"
}
# robots.txt of a site: its Disallow lines for every reader, and where its sitemaps are.
read_robots() {
	if grep -qxF "$1" "$work/origins"; then return 0; fi
	printf '%s\n' "$1" >> "$work/origins"
	curl -fsL --max-time 30 -A "$agent" "$1/robots.txt" 2>/dev/null | tr -d '\r' | sed 's/#.*//' > "$work/robots" || :
	agents=0
	applies=0
	while IFS= read -r line; do
		key=$(printf '%s' "$line" | sed 's/:.*//' | tr 'A-Z' 'a-z' | tr -d ' \t')
		value=$(printf '%s' "$line" | sed -e 's/^[^:]*:[[:space:]]*//' -e 's/[[:space:]]*$//')
		case "$key" in
			user-agent)
				if [ "$agents" -eq 0 ]; then applies=0; fi
				agents=1
				if [ "$value" = "*" ]; then applies=1; fi
				;;
			disallow)
				agents=0
				if [ "$applies" -eq 1 ] && [ -n "$value" ]; then
					printf '%s%s\n' "$1" "$(printf '%s' "$value" | sed -e 's/\*.*//' -e 's/\$$//')" >> "$work/blocked"
				fi
				;;
			"") ;;
			*) agents=0 ;;
		esac
	done < "$work/robots"
	sed -n 's/^[Ss][Ii][Tt][Ee][Mm][Aa][Pp]:[[:space:]]*//p' "$work/robots" | sed 's/[[:space:]]*$//' > "$work/todo"
	if [ ! -s "$work/todo" ]; then printf '%s/sitemap.xml\n' "$1" > "$work/todo"; fi
	maps=0
	while [ -s "$work/todo" ] && [ "$maps" -lt ${WEB_MAX_SITEMAPS} ]; do
		map=$(sed -n 1p "$work/todo")
		sed 1d "$work/todo" > "$work/todo.next"
		mv "$work/todo.next" "$work/todo"
		maps=$((maps + 1))
		curl -fsL --compressed --max-time 60 -A "$agent" "$map" 2>/dev/null | tr -d '\r\n\t' > "$work/map.xml" || continue
		grep -o '<loc>[^<]*</loc>' "$work/map.xml" | sed -e 's#<loc>##' -e 's#</loc>##' -e 's/^ *//' -e 's/ *$//' -e 's/&amp;/\&/g' > "$work/locs" || :
		if grep -q '<sitemapindex' "$work/map.xml"; then
			cat "$work/locs" >> "$work/todo"
		else
			cat "$work/locs" >> "$work/listed"
		fi
	done
	rm -f "$work/todo"
}
for url in $urls; do
	url=$(clean "$url")
	if [ -z "$scope" ]; then folder_of "$url" >> "$work/scopes"; echo >> "$work/scopes"; fi
	read_robots "$(origin_of "$url")"
done
if [ -n "$scope" ]; then
	for prefix in $scope; do printf '%s\n' "$prefix" >> "$work/scopes"; done
fi
while IFS= read -r url; do
	url=$(clean "$url")
	if wanted "$url"; then printf '%s\n' "$url" >> "$work/mapped"; fi
done < "$work/listed"
# Start pages first. A site whose sitemap lists pages in scope: those pages, and no link followed.
for url in $urls; do
	url=$(clean "$url")
	if blocked "$url"; then
		echo "Did not read $url: the site asks readers to stay away from it." >&2
	else
		site=$(origin_of "$url")
		at=0
		while IFS= read -r page; do
			case "$page" in "$site/"*) at=$depth ;; esac
		done < "$work/mapped"
		enqueue "$at" "$url"
	fi
done
# One page past the limit is enough to know that the limit cuts the crawl.
queued=0
while IFS= read -r url && [ "$queued" -le "$limit" ]; do
	enqueue "$depth" "$url"
	queued=$((queued + 1))
done < "$work/mapped"
kept=0
missed=0
cut=0
hidden=0
while [ -s "$work/queue" ]; do
	if [ "$requests" -ge "$limit" ]; then cut=1; break; fi
	line=$(sed -n 1p "$work/queue")
	sed 1d "$work/queue" > "$work/queue.next"
	mv "$work/queue.next" "$work/queue"
	at=$(printf '%s' "$line" | sed 's/ .*//')
	url=$(printf '%s' "$line" | sed 's/^[^ ]* //')
	name=$(name_of "$url")
	printf '%s.md\n' "$name" >> "$work/crawled"
	if ! read_page "$url"; then
		missed=$((missed + 1))
		# The pages below it are unknown: a page that left the crawl may still be there.
		if [ "$at" -lt "$depth" ]; then hidden=1; fi
		continue
	fi
	kept=$((kept + 1))
	if [ "$at" -ge "$depth" ]; then continue; fi
	site=$(origin_of "$url")
	{ grep -oE '[]][(](https?://|/)[^) ]*' "$dest/$name.md" || :; } | sed 's/^](//' | while IFS= read -r link; do
		case "$link" in
			//*) link="$(printf '%s' "$url" | sed 's#:.*##'):$link" ;;
			/*) link="$site$link" ;;
		esac
		link=$(clean "$link")
		if wanted "$link"; then enqueue $((at + 1)) "$link"; fi
	done
done
if [ "$kept" -eq 0 ]; then exit 1; fi
if [ "$cut" -eq 0 ] && [ "$hidden" -eq 0 ]; then
	find "$dest" -maxdepth 1 -type f -name '*.md' | while IFS= read -r file; do
		if ! grep -qxF "$(basename "$file")" "$work/crawled"; then
			rm -f "$file"
			echo "Removed $(basename "$file"): the page is no longer in the crawl."
		fi
	done
fi
skipped=""
if [ "$cut" -eq 1 ]; then skipped=". Stopped at $limit pages"; fi
if [ "$missed" -gt 0 ]; then skipped="$skipped. Could not read $missed pages"; fi
fi`;

/** The Web pages source. */
export const WEB_SOURCE = defineSyncKit({
	name: "web",
	label: "Web pages",
	blurb: "Any public page as text, and the pages it links to.",
	flowName: "knowledge-web-pages",
	main: "urls",
	lines: ["urls", "scope"],
	switches: { follow: ["scope", "limit", "depth"] },
	programs: [{ name: "curl" }],
	description:
		"Copies web pages into the project's knowledge as markdown. It needs no account. Each page gets a file named after its address. A page that cannot be read does not stop the others. With Follow links, it also copies the pages that they link to.",
	inputs: [
		{
			name: "urls",
			label: "Pages",
			type: "text",
			description:
				"The pages, one address per line, for example https://example.com/docs.",
			required: true,
		},
		{
			name: "follow",
			label: "Follow links",
			type: "boolean",
			description:
				"Also copy the pages that these pages link to. Pages that leave the site leave the knowledge too.",
			default: "false",
		},
		{
			name: "scope",
			label: "Only addresses that start with",
			type: "text",
			description:
				"One address per line. Empty: the folder of each page, for example https://example.com/docs/.",
		},
		{
			name: "limit",
			label: "Most pages",
			type: "number",
			description: `At most ${WEB_MAX_PAGES}.`,
			default: "100",
		},
		{
			name: "depth",
			label: "Links away",
			type: "number",
			description: "How many links away from your pages to go.",
			default: "3",
		},
	],
	folder: "web",
	stepLabel: "Read the pages",
	script: WEB_SCRIPT,
	data: { skipped: "$skipped" },
	messages: {
		synced: "Pages synced",
		syncedMore: "{{sync.data.skipped}}",
		notSynced: "Could not read any page. {{sync.log_tail}}",
	},
});
