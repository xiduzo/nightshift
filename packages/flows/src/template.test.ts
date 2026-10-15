import { describe, expect, test } from "bun:test";
import { renderCommand, renderTemplate, templateRefs } from "./template";
import type { TemplateContext } from "./types";

const context: TemplateContext = {
	nodes: {
		check: { outcome: "fail", exit_code: 1, log_tail: "1 test failed" },
		worker: { output: "done", visit: 2 },
	},
	run: {
		branch: "nightshift/fix",
		worktree: "/tmp/wt",
		base_ref: "main",
		flow: "retry",
	},
};

describe("templateRefs", () => {
	test("finds every reference in order", () => {
		expect(templateRefs("Fix {{check.log_tail}} on {{ run.branch }}.")).toEqual(
			[
				{ scope: "check", field: "log_tail", raw: "{{check.log_tail}}" },
				{ scope: "run", field: "branch", raw: "{{ run.branch }}" },
			],
		);
	});

	test("allows any whitespace inside the braces", () => {
		expect(templateRefs("{{\n\tcheck.exit_code  }}")).toEqual([
			{ scope: "check", field: "exit_code", raw: "{{\n\tcheck.exit_code  }}" },
		]);
	});

	test("ignores anything that is not scope.field", () => {
		expect(
			templateRefs(
				"{{check}} {{Check.log}} {{check.Log}} {{a.b.c}} {{1a.b}} {{ check . log }} {check.log}",
			),
		).toEqual([]);
	});

	test("returns nothing for plain text", () => {
		expect(templateRefs("no templates here")).toEqual([]);
	});
});

describe("renderTemplate", () => {
	test("replaces node and run references", () => {
		expect(
			renderTemplate(
				"Tests said: {{ check.log_tail }} (exit {{check.exit_code}}) on {{run.branch}}",
				context,
			),
		).toBe("Tests said: 1 test failed (exit 1) on nightshift/fix");
	});

	test("renders numbers with String()", () => {
		expect(renderTemplate("visit {{worker.visit}}", context)).toBe("visit 2");
	});

	test("renders missing values as an empty string", () => {
		expect(
			renderTemplate(
				"[{{nope.output}}][{{check.summary}}][{{run.missing}}]",
				context,
			),
		).toBe("[][][]");
	});

	test("does not read inherited properties", () => {
		expect(
			renderTemplate("[{{check.constructor}}][{{constructor.name}}]", context),
		).toBe("[][]");
	});

	test("leaves anything else between braces untouched", () => {
		const text = "{{check}} {{a.b.c}} {{ Check.log }} {x.y}";
		expect(renderTemplate(text, context)).toBe(text);
	});
});

describe("renderCommand", () => {
	const context = {
		nodes: { worker: { summary: 'done $(touch pwned) "quoted"' } },
		run: {
			branch: "nightshift/abc",
			worktree: "/wt",
			base_ref: "main",
			flow: "demo",
		},
	};

	test("turns references into environment variables", () => {
		const { command, env } = renderCommand(
			'echo "{{worker.summary}}" on {{ run.branch }} {{check.log_tail}}',
			context,
		);
		const v = (name: string) => `\${${name}}`;
		const expected = `echo "${v("NS_WORKER_SUMMARY")}" on ${v("NS_RUN_BRANCH")} ${v("NS_CHECK_LOG_TAIL")}`;
		expect(command).toBe(expected);
		expect(env).toEqual({
			NS_WORKER_SUMMARY: 'done $(touch pwned) "quoted"',
			NS_RUN_BRANCH: "nightshift/abc",
			NS_CHECK_LOG_TAIL: "",
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
