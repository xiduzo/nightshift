import { describe, expect, test } from "bun:test";
import type { SubflowBlocker, SubflowChange } from "@nightshift/flows";
import {
	type SubflowCopyContext,
	subflowBlockerText,
	subflowChangeText,
} from "./make-subflow-copy";

const context: SubflowCopyContext = {
	flow: {
		sections: [{ id: "review", label: "Review", nodes: ["ux", "code"] }],
		edges: [
			{ id: "code-pass-ux", from: "code", outcome: "pass", to: "ux", max: 2 },
		],
	},
};

// One sample per code. The mapped types fail the type check when the
// planner gains a code that has no sample here.
const changes: {
	[C in SubflowChange["code"]]: Extract<SubflowChange, { code: C }>;
} = {
	"nodes-moved": {
		kind: "info",
		code: "nodes-moved",
		nodes: ["ux", "code"],
		entry: "ux",
	},
	"call-added": {
		kind: "info",
		code: "call-added",
		node: "review",
		flow: "review",
	},
	"start-moved": {
		kind: "info",
		code: "start-moved",
		from: "ux",
		to: "review",
	},
	"input-added": {
		kind: "info",
		code: "input-added",
		input: "spec_data",
		type: "json",
		source: { kind: "node", node: "spec", field: "data" },
		readBy: ["ux"],
	},
	"output-added": {
		kind: "info",
		code: "output-added",
		output: "code_summary",
		node: "code",
		field: "summary",
		readBy: [{ node: "publish" }, { output: "summary" }],
	},
	"variable-written-back": {
		kind: "info",
		code: "variable-written-back",
		variable: "findings",
		output: "findings",
		writtenBy: ["ux", "code"],
	},
	"exit-added": {
		kind: "info",
		code: "exit-added",
		label: "pass",
		from: "code",
		outcome: "pass",
		to: ["approver"],
		endNode: null,
	},
	"decision-added": {
		kind: "info",
		code: "decision-added",
		node: "review_ended",
		options: ["pass", "changes"],
	},
	"ends-inside": {
		kind: "info",
		code: "ends-inside",
		ends: [{ node: "code", outcome: "done", option: "pass" }],
	},
	"section-removed": {
		kind: "info",
		code: "section-removed",
		section: "review",
	},
	"restarts-on-resume": { kind: "differs", code: "restarts-on-resume" },
	"reads-earlier-pass": {
		kind: "differs",
		code: "reads-earlier-pass",
		reads: [{ node: "publish", reads: "code" }],
	},
	"visit-per-call": {
		kind: "differs",
		code: "visit-per-call",
		reads: [{ node: "ux", reads: "ux" }],
	},
	"loop-limit-per-call": {
		kind: "differs",
		code: "loop-limit-per-call",
		edges: ["code-pass-ux"],
	},
	"session-per-call": {
		kind: "differs",
		code: "session-per-call",
		nodes: ["code"],
	},
};

const blockers: {
	[C in SubflowBlocker["code"]]: Extract<SubflowBlocker, { code: C }>;
} = {
	"section-not-found": { code: "section-not-found", section: "review" },
	"name-not-valid": { code: "name-not-valid", name: "Review!" },
	"name-taken": { code: "name-taken", name: "review" },
	"section-not-valid": {
		code: "section-not-valid",
		problems: [{ code: "several-entries", entries: ["ux", "code"] }],
	},
	"flow-not-valid": { code: "flow-not-valid", errors: 2 },
	"stopped-edge": { code: "stopped-edge", nodes: ["batch"] },
	"calls-new-flow": { code: "calls-new-flow", nodes: ["batch"] },
	"mixed-exit": {
		code: "mixed-exit",
		from: "code",
		outcome: "changes",
		edges: ["a", "b"],
	},
	"rule-reads-outside": {
		code: "rule-reads-outside",
		node: "verdict",
		names: ["spec", "run.flow"],
	},
	"rule-reads-inside": {
		code: "rule-reads-inside",
		node: "route",
		names: ["verdict"],
	},
	"loop-without-limit": {
		code: "loop-without-limit",
		edges: ["code-pass-ux"],
	},
	"result-not-valid": {
		code: "result-not-valid",
		flow: "subflow",
		issues: [{ severity: "error", message: "nodes.0: bad" }],
	},
};

/** Things the person must not see: internals, contractions, semicolons. */
const NOT_SHOWN = [
	/undefined/,
	/\bnull\b/,
	/\[object/,
	/;/,
	/\b\w+'(t|s|re|ll|ve|d)\b/,
	/daemon|worktree|\.json|stdout|exit code|lease|parse/i,
];

function expectPlain(text: { title: string; description: string }) {
	expect(text.title.trim()).not.toBe("");
	expect(text.description.trim()).not.toBe("");
	for (const pattern of NOT_SHOWN) {
		expect(text.title).not.toMatch(pattern);
		expect(text.description).not.toMatch(pattern);
	}
	// One idea per sentence, at most 20 words (with one-item lists).
	for (const sentence of text.description.split(/(?<=[.!?])\s+/)) {
		expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
	}
	expect(text.description).toMatch(/[.]$/);
}

describe("subflowChangeText", () => {
	for (const [code, change] of Object.entries(changes)) {
		test(`words ${code}`, () => {
			expectPlain(subflowChangeText(change, context));
		});
	}

	test("names what it moves and who reads it", () => {
		expect(subflowChangeText(changes["nodes-moved"], context)).toEqual({
			title: "Moves 2 nodes to the new flow",
			description: '"ux" and "code" move. The new flow starts at "ux".',
		});
		expect(
			subflowChangeText(changes["output-added"], context).description,
		).toBe(
			'It gives {{code.summary}} back to this flow. "publish" and the output "summary" read it from the Subflow now.',
		);
		expect(
			subflowChangeText(changes["section-removed"], context).description,
		).toBe(
			'The Section "Review" goes from this flow. Its nodes are in the new flow.',
		);
	});

	test("an edge reads as where it goes from and to", () => {
		expect(
			subflowChangeText(changes["loop-limit-per-call"], context).description,
		).toStartWith('The edge from "code" to "ux" has a max.');
	});
});

describe("subflowBlockerText", () => {
	for (const [code, blocker] of Object.entries(blockers)) {
		test(`words ${code}`, () => {
			expectPlain(subflowBlockerText(blocker, context));
		});
	}

	test("a rule that reads a run field cannot move it", () => {
		expect(
			subflowBlockerText(
				{ code: "rule-reads-outside", node: "v", names: ["run.flow"] },
				context,
			).description,
		).toBe(
			'It reads "run.flow" from outside the Section. Read it in a template instead.',
		);
	});

	test("a Section that is not valid uses the Section words", () => {
		expect(
			subflowBlockerText(blockers["section-not-valid"], context).description,
		).toContain('The flow comes in at "ux" and "code".');
	});
});
