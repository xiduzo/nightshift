import type { FlowInput } from "../../flow";
import { FEED_ITEM_SHAPE } from "../../shapes";

/** The items of a feed, as the Convert node gives them. */
const FEED_ITEMS = { type: "array", items: FEED_ITEM_SHAPE };

/**
 * `kit:feeds/read`: the items of an RSS, Atom or JSON feed that are new
 * since the last run. Three nodes with no shell and no CLI do the work: a
 * Web request reads the feed, a Convert reads it into items, and a Since
 * last run keeps the ones it never saw. Its memory is per feed (`scope`).
 *
 * The Since last run counts every item new on its first run. The input
 * `first_run` (default `same`) then decides: `same` only remembers them,
 * `new` gives them. A Branch makes that choice, so the kit keeps one
 * memory whatever the input says.
 */
export const feedsReadKit: FlowInput = {
	version: 9,
	description:
		"Reads an RSS, Atom or JSON feed and gives the items that are new since the last run. On its first run, it only remembers the items that are there.",
	inputs: [
		{
			name: "url",
			type: "text",
			description:
				"The address of the feed, for example https://example.com/feed.xml.",
			required: true,
		},
		{
			name: "first_run",
			type: "choice",
			options: ["same", "new"],
			description:
				"What the first run gives. same: nothing, it only remembers the items. new: every item.",
			default: "same",
		},
	],
	outputs: [
		{
			name: "items",
			value: "{{vars.items}}",
			description:
				"The new items, each with id, title, link, summary, content, published, updated, authors and categories.",
			type: "json",
			schema: FEED_ITEMS,
		},
		{
			name: "title",
			value: "{{parse.data.title}}",
			description: "The title of the feed.",
			type: "text",
		},
	],
	variables: [
		{
			name: "items",
			type: "json",
			initial: "[]",
			schema: FEED_ITEMS,
			description: "The new items this run gives.",
		},
	],
	start: "fetch",
	nodes: [
		{
			id: "fetch",
			type: "web-request",
			label: "Read the feed",
			position: { x: 0, y: 0 },
			method: "GET",
			url: "{{url}}",
		},
		{
			id: "parse",
			type: "convert",
			label: "Read its items",
			position: { x: 300, y: 0 },
			from: "feed",
			to: "json",
			value: "{{fetch.body}}",
		},
		{
			id: "fresh",
			type: "since-last-run",
			label: "Keep the new items",
			position: { x: 600, y: 0 },
			items: "{{parse.data.items}}",
			key: "id",
			scope: "{{url}}",
			firstRun: "new",
		},
		{
			id: "first",
			type: "decision",
			label: "First run?",
			position: { x: 900, y: -80 },
			by: "rule",
			prompt:
				"On the first run with first_run set to same, it only remembers the items.",
			options: [
				{
					name: "remember",
					when: 'fresh.data.first_run and first_run = "same"',
					color: "gray",
				},
				{ name: "give", color: "green" },
			],
			set: [{ variable: "items", value: "{{fresh.data.new}}", on: ["give"] }],
		},
		{
			id: "found",
			type: "end",
			position: { x: 1200, y: -160 },
			status: "done",
			message: "The feed has new items",
		},
		{
			id: "remembered",
			type: "end",
			position: { x: 1200, y: -40 },
			status: "nothing-to-do",
			message:
				"Remembered the items of the feed. The next run gives what is new",
		},
		{
			id: "nothing_new",
			type: "end",
			position: { x: 900, y: 80 },
			status: "nothing-to-do",
			message: "Nothing new in the feed",
		},
		{
			id: "unreadable",
			type: "end",
			position: { x: 300, y: 160 },
			status: "failed",
			message: "Could not read the feed {{url}}",
		},
		{
			id: "not_a_feed",
			type: "end",
			position: { x: 600, y: 160 },
			status: "failed",
			message: "{{url}} is not a feed: {{parse.note}}",
		},
	],
	edges: [
		{ id: "fetch-pass", from: "fetch", outcome: "pass", to: "parse" },
		{ id: "fetch-fail", from: "fetch", outcome: "fail", to: "unreadable" },
		{ id: "parse-pass", from: "parse", outcome: "pass", to: "fresh" },
		{ id: "parse-fail", from: "parse", outcome: "fail", to: "not_a_feed" },
		{ id: "fresh-new", from: "fresh", outcome: "new", to: "first" },
		{
			id: "fresh-changed",
			from: "fresh",
			outcome: "changed",
			to: "nothing_new",
		},
		{ id: "fresh-same", from: "fresh", outcome: "same", to: "nothing_new" },
		{ id: "first-give", from: "first", outcome: "give", to: "found" },
		{
			id: "first-remember",
			from: "first",
			outcome: "remember",
			to: "remembered",
		},
	],
};
