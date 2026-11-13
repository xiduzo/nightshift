import { describe, expect, test } from "bun:test";
import { flowSchema } from "../../flow";
import { defineSyncKit, KNOWLEDGE_FOLDER_INPUT } from "./sync-kit";

/** A source only this test knows: what one declaration must say. */
const source = {
	name: "notes",
	label: "Notes",
	blurb: "Your notes.",
	flowName: "knowledge-notes",
	main: "from",
	lines: ["from"],
	programs: [
		{ name: "curl" },
		{ name: "jq", why: "this kit reads the notes with it" },
	],
	description: "Copies notes.",
	inputs: [{ name: "from", type: "text", required: true }],
	folder: "notes",
	stepLabel: "Copy the notes",
	script: 'cp "{{from}}" "$dest"',
	messages: { synced: "Notes copied", notSynced: "Could not copy the notes" },
} as const;

function commandOf(flow: ReturnType<typeof defineSyncKit>["flow"]): string {
	const node = flow.nodes.find((one) => one.id === "sync");
	if (node?.type !== "command") throw new Error("The kit has no sync step.");
	return node.command;
}

describe("defineSyncKit", () => {
	test("one declaration yields a valid kit and its kind", () => {
		const { kit, kind, flow } = defineSyncKit(source);
		expect(kit).toBe("kit:knowledge/notes");
		expect(kind).toEqual({
			kit: "kit:knowledge/notes",
			label: "Notes",
			blurb: "Your notes.",
			flowName: "knowledge-notes",
			main: "from",
			lines: ["from"],
			switches: {},
			local: false,
			needsFolder: false,
			programs: ["curl", "jq"],
		});
		const parsed = flowSchema.parse(flow);
		expect(parsed.inputs.map((input) => input.name)).toEqual([
			"from",
			KNOWLEDGE_FOLDER_INPUT,
		]);
		expect(parsed.inputs.at(-1)?.default).toBe("notes");
		expect(parsed.nodes.map((node) => node.id)).toEqual([
			"sync",
			"synced",
			"not_synced",
		]);
	});

	test("only a program with a reason gets a check, and it comes before the script", () => {
		const command = commandOf(defineSyncKit(source).flow);
		expect(command).toContain(
			'if ! command -v jq >/dev/null; then echo "Install jq: this kit reads the notes with it." >&2; exit 2; fi\ncp ',
		);
		expect(command).not.toContain("command -v curl");
	});

	test("a stop is an outcome of the step, and an end of the flow", () => {
		const { flow } = defineSyncKit({
			...source,
			stops: [
				{ outcome: "nothing", code: 3, end: "none", message: "No notes" },
				{ outcome: "too-many", code: 4, end: "many", message: "Too many" },
			],
		});
		const parsed = flowSchema.parse(flow);
		const step = parsed.nodes.find((node) => node.id === "sync");
		if (step?.type !== "command") throw new Error("The kit has no sync step.");
		expect(step.exits?.map((exit) => exit.name)).toEqual([
			"synced",
			"nothing",
			"too-many",
			"fail",
		]);
		expect(parsed.edges.at(-1)).toMatchObject({
			from: "sync",
			outcome: "too-many",
			to: "many",
		});
		expect(parsed.nodes.at(-1)).toMatchObject({
			id: "many",
			type: "end",
			status: "failed",
			message: "Too many",
		});
	});

	test("more data follows the file count, and its message can read it", () => {
		const { flow } = defineSyncKit({
			...source,
			data: { skipped: "$skipped" },
			messages: {
				...source.messages,
				syncedMore: "{{sync.data.skipped}}",
			},
		});
		expect(commandOf(flow)).toEndWith(
			`printf '{"files": %s, "skipped": "%s"}' "$files" "$skipped" > "$NS_OUTPUT"`,
		);
		expect(flow.nodes.find((node) => node.id === "synced")).toMatchObject({
			message: "Notes copied: {{sync.data.files}} files{{sync.data.skipped}}",
		});
	});

	test("main and lines can name only the source's own inputs", () => {
		// The compiler refuses a kind that drifts from its kit: `check-types` fails.
		// @ts-expect-error "nope" is not an input of this source.
		defineSyncKit({ ...source, main: "nope" });
		// @ts-expect-error "nope" is not an input of this source.
		defineSyncKit({ ...source, lines: ["nope"] });
		// @ts-expect-error "nope" is not an input of this source.
		defineSyncKit({ ...source, switches: { from: ["nope"] } });
	});
});
