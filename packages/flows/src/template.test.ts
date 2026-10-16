import { describe, expect, test } from "bun:test";
import {
	lookupRef,
	renderCommand,
	renderTemplate,
	renderValue,
	templateEnvName,
	templateRefs,
} from "./template";
import type { TemplateContext } from "./types";

const run: TemplateContext["run"] = {
	branch: "nightshift/fix",
	base_branch: "",
	index: "",
	worktree: "/tmp/wt",
	base_ref: "main",
	flow: "retry",
};

const context: TemplateContext = {
	nodes: {
		check: { outcome: "fail", exit_code: 1, log_tail: "1 test failed" },
		worker: { output: "done", visit: 2, data: null },
		planner: {
			outcome: "pass",
			data: {
				tasks: [
					{ id: "a", title: "Add login", tags: ["auth", "ui"] },
					{ id: "b", title: "Add logout", done: true },
				],
				count: 2,
			},
		},
	},
	inputs: {
		epic: "1097",
		item: {
			number: 12,
			title: "Add login",
			parent: { number: 7, title: "Accounts" },
			labels: ["trace"],
			"kebab-key": "yes",
		},
		empty: null,
	},
	run,
};

describe("templateRefs", () => {
	test("finds every reference in order, with its path", () => {
		expect(
			templateRefs("Fix {{check.log_tail}} on {{ run.branch }} for {{epic}}."),
		).toEqual([
			{ name: "check", path: ["log_tail"], raw: "{{check.log_tail}}" },
			{ name: "run", path: ["branch"], raw: "{{ run.branch }}" },
			{ name: "epic", path: [], raw: "{{epic}}" },
		]);
	});

	test("paths go deep, through array indexes and any key case", () => {
		expect(
			templateRefs("{{planner.data.tasks.0.title}} {{item.Parent-ID_2}}"),
		).toEqual([
			{
				name: "planner",
				path: ["data", "tasks", "0", "title"],
				raw: "{{planner.data.tasks.0.title}}",
			},
			{ name: "item", path: ["Parent-ID_2"], raw: "{{item.Parent-ID_2}}" },
		]);
	});

	test("allows any whitespace inside the braces", () => {
		expect(templateRefs("{{\n\tcheck.exit_code  }}")).toEqual([
			{
				name: "check",
				path: ["exit_code"],
				raw: "{{\n\tcheck.exit_code  }}",
			},
		]);
	});

	test("ignores anything that is not a reference", () => {
		expect(
			templateRefs(
				"{{Check.log}} {{1a.b}} {{ check . log }} {check.log} {{a.}} {{a..b}} {{a.b c}} {{_a}}",
			),
		).toEqual([]);
	});

	test("returns nothing for plain text", () => {
		expect(templateRefs("no templates here")).toEqual([]);
	});
});

describe("lookupRef", () => {
	test("reads run, inputs and nodes", () => {
		expect(lookupRef(context, { name: "run", path: ["branch"] })).toBe(
			"nightshift/fix",
		);
		expect(lookupRef(context, { name: "epic", path: [] })).toBe("1097");
		expect(lookupRef(context, { name: "check", path: ["exit_code"] })).toBe(1);
	});

	test("walks into objects and arrays", () => {
		expect(
			lookupRef(context, { name: "item", path: ["parent", "number"] }),
		).toBe(7);
		expect(
			lookupRef(context, {
				name: "planner",
				path: ["data", "tasks", "1", "title"],
			}),
		).toBe("Add logout");
		expect(
			lookupRef(context, { name: "planner", path: ["data", "tasks"] }),
		).toEqual([
			{ id: "a", title: "Add login", tags: ["auth", "ui"] },
			{ id: "b", title: "Add logout", done: true },
		]);
		expect(lookupRef(context, { name: "item", path: ["kebab-key"] })).toBe(
			"yes",
		);
	});

	test("missing values are undefined", () => {
		const missing = [
			{ name: "nope", path: [] },
			{ name: "check", path: ["summary"] },
			{ name: "item", path: ["parent", "number", "deeper"] },
			{ name: "planner", path: ["data", "tasks", "5"] },
			{ name: "planner", path: ["data", "tasks", "01"] },
			{ name: "planner", path: ["data", "tasks", "-1"] },
			{ name: "planner", path: ["data", "tasks", "length"] },
			{ name: "epic", path: ["length"] },
			{ name: "run", path: ["nope"] },
			{ name: "item", path: ["constructor"] },
			{ name: "constructor", path: ["name"] },
		];
		for (const ref of missing) expect(lookupRef(context, ref)).toBeUndefined();
	});

	test("null is a value", () => {
		expect(lookupRef(context, { name: "empty", path: [] })).toBeNull();
	});

	test("an input wins over a node of the same name", () => {
		const shadow: TemplateContext = {
			...context,
			nodes: { ...context.nodes, item: { title: "node" } },
		};
		expect(lookupRef(shadow, { name: "item", path: ["title"] })).toBe(
			"Add login",
		);
	});
});

describe("renderTemplate", () => {
	test("replaces node, input and run references", () => {
		expect(
			renderTemplate(
				"Epic {{epic}}: {{ check.log_tail }} (exit {{check.exit_code}}) on {{run.branch}}, #{{item.number}} under {{item.parent.title}}",
				context,
			),
		).toBe(
			"Epic 1097: 1 test failed (exit 1) on nightshift/fix, #12 under Accounts",
		);
	});

	test("renders numbers and booleans with String()", () => {
		expect(
			renderTemplate(
				"visit {{worker.visit}} {{planner.data.tasks.1.done}}",
				context,
			),
		).toBe("visit 2 true");
	});

	test("renders objects and arrays as JSON", () => {
		expect(renderTemplate("{{item.labels}}", context)).toBe('["trace"]');
		expect(renderTemplate("{{item.parent}}", context)).toBe(
			'{"number":7,"title":"Accounts"}',
		);
		expect(renderTemplate("{{planner.data.tasks.0.tags}}", context)).toBe(
			'["auth","ui"]',
		);
	});

	test("renders missing values and null as an empty string", () => {
		expect(
			renderTemplate(
				"[{{nope.output}}][{{check.summary}}][{{run.missing}}][{{empty}}][{{worker.data}}]",
				context,
			),
		).toBe("[][][][][]");
	});

	test("does not read inherited properties", () => {
		expect(
			renderTemplate("[{{check.constructor}}][{{constructor.name}}]", context),
		).toBe("[][]");
	});

	test("leaves anything else between braces untouched", () => {
		const text = "{{ Check.log }} {x.y} {{a..b}}";
		expect(renderTemplate(text, context)).toBe(text);
	});
});

describe("renderValue", () => {
	test("one reference keeps its JSON value", () => {
		expect(renderValue("{{planner.data.tasks}}", context)).toEqual([
			{ id: "a", title: "Add login", tags: ["auth", "ui"] },
			{ id: "b", title: "Add logout", done: true },
		]);
		expect(renderValue("  {{ item.parent }}\n", context)).toEqual({
			number: 7,
			title: "Accounts",
		});
		expect(renderValue("{{check.exit_code}}", context)).toBe(1);
		expect(renderValue("{{planner.data.tasks.1.done}}", context)).toBe(true);
	});

	test("a missing reference is null", () => {
		expect(renderValue("{{nope.data}}", context)).toBeNull();
		expect(renderValue("{{empty}}", context)).toBeNull();
	});

	test("any other template renders as text", () => {
		expect(renderValue("#{{item.number}}", context)).toBe("#12");
		expect(renderValue("{{item.number}}{{epic}}", context)).toBe("121097");
		expect(renderValue("plain", context)).toBe("plain");
		expect(renderValue("[{{item.labels}}]", context)).toBe('[["trace"]]');
	});
});

describe("templateEnvName", () => {
	test("joins name and path keys in upper case", () => {
		expect(templateEnvName("item", ["parent", "number"])).toBe(
			"NS_ITEM_PARENT_NUMBER",
		);
		expect(templateEnvName("epic", [])).toBe("NS_EPIC");
		expect(templateEnvName("worker", ["summary"])).toBe("NS_WORKER_SUMMARY");
	});

	test("turns other characters into _", () => {
		expect(templateEnvName("item", ["kebab-key", "Mixed", "0"])).toBe(
			"NS_ITEM_KEBAB_KEY_MIXED_0",
		);
	});
});

describe("renderCommand", () => {
	const context: TemplateContext = {
		nodes: { worker: { summary: 'done $(touch pwned) "quoted"' } },
		inputs: {
			epic: "1097",
			item: { parent: { number: 7 }, labels: ["a", "b"], b_c: "flat" },
		},
		run: { ...run, branch: "nightshift/abc" },
	};
	const v = (name: string) => `\${${name}}`;

	test("turns references into environment variables", () => {
		const { command, env } = renderCommand(
			'echo "{{worker.summary}}" on {{ run.branch }} {{check.log_tail}} for {{epic}}',
			context,
		);
		expect(command).toBe(
			`echo "${v("NS_WORKER_SUMMARY")}" on ${v("NS_RUN_BRANCH")} ${v("NS_CHECK_LOG_TAIL")} for ${v("NS_EPIC")}`,
		);
		expect(env).toEqual({
			NS_WORKER_SUMMARY: 'done $(touch pwned) "quoted"',
			NS_RUN_BRANCH: "nightshift/abc",
			NS_CHECK_LOG_TAIL: "",
			NS_EPIC: "1097",
		});
	});

	test("paths become part of the name; JSON values arrive as JSON text", () => {
		expect(
			renderCommand(
				"gh issue view {{item.parent.number}} {{item.labels}}",
				context,
			),
		).toEqual({
			command: `gh issue view ${v("NS_ITEM_PARENT_NUMBER")} ${v("NS_ITEM_LABELS")}`,
			env: { NS_ITEM_PARENT_NUMBER: "7", NS_ITEM_LABELS: '["a","b"]' },
		});
	});

	test("one variable per distinct reference", () => {
		const { command, env } = renderCommand(
			"{{epic}} {{ epic }} {{item.b_c}} {{item.b.c}} {{item.b_c}}",
			context,
		);
		expect(command).toBe(
			`${v("NS_EPIC")} ${v("NS_EPIC")} ${v("NS_ITEM_B_C")} ${v("NS_ITEM_B_C_2")} ${v("NS_ITEM_B_C")}`,
		);
		expect(env).toEqual({
			NS_EPIC: "1097",
			NS_ITEM_B_C: "flat",
			NS_ITEM_B_C_2: "",
		});
	});

	test("a value never runs as shell", async () => {
		const { command, env } = renderCommand(
			'echo "{{worker.summary}}"',
			context,
		);
		const proc = Bun.spawnSync(["sh", "-c", command], {
			env: { ...process.env, ...env },
			cwd: "/tmp",
		});
		expect(proc.stdout.toString().trim()).toBe('done $(touch pwned) "quoted"');
	});
});
