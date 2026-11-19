/**
 * The generators of `turbo/generators/` (H11): what they make keeps the
 * ring check. Each test runs the steps of a generator on the small
 * repository of the ring check's tests, as `turbo gen` runs them, and asks
 * `checkRings` about the result. The format step (Biome) is left out: it
 * changes the layout, not a rule. A template is rendered by putting each
 * value in its `{{{name}}}`. The first test proves that a template holds
 * no other Handlebars, so plop renders it the same way.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { PlopTypes } from "@turbo/gen";
import generator from "../turbo/generators/config";
import {
	GeneratorRefusal,
	withMapLine,
	withMember,
} from "../turbo/generators/edits";
import {
	adapterSteps,
	type Data,
	camel as generatedCamel,
	kebab as generatedKebab,
	type Step,
	sliceSteps,
	useCaseSteps,
} from "../turbo/generators/steps";
import { checkRings } from "./check-rings";
import { camel, kebab } from "./rings/files";
import { DEFAULTS, manifest, repository, SLICE, write } from "./rings/fixture";

const TEMPLATES = join(
	import.meta.dir,
	"..",
	"turbo",
	"generators",
	"templates",
);
const MAP = readFileSync(join(import.meta.dir, "capabilities.ts"), "utf8");
const PLACEHOLDER = /\{\{\{(\w+)\}\}\}/g;

/** The ring check of the fixture, with `engine/runs` as a mechanism: it has no rings here. */
const OPTIONS = {
	...DEFAULTS,
	mechanisms: [...(DEFAULTS.mechanisms ?? []), "engine/runs"],
};

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const render = (template: string, data: Data) =>
	template.replace(PLACEHOLDER, (_, name: string) => {
		const value = data[name];
		if (value === undefined) throw new Error(`no value for {{{${name}}}}`);
		return value;
	});

/** Does what plop does with `steps` in `root`, apart from the format. */
function run(root: string, steps: Step[]): void {
	for (const step of steps) {
		if (step.kind === "format") continue;
		const path = join(root, step.path);
		if (step.kind === "edit") {
			writeFileSync(path, step.edit(readFileSync(path, "utf8")));
			continue;
		}
		const text = render(
			readFileSync(join(TEMPLATES, step.template), "utf8"),
			step.data,
		);
		if (step.kind === "append") {
			writeFileSync(path, `${readFileSync(path, "utf8")}\n${text}`);
			continue;
		}
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text, { flag: "wx" });
	}
}

/** The ring check's repository, with `devices` and the capability map. */
function repositoryWithMap(): string {
	return write(
		{
			...repository,
			"packages/devices/package.json": manifest("devices", {
				".": "./src/index.ts",
			}),
			"packages/devices/src/index.ts": "export {};\n",
			// What the access port of a generated slice names: @filledBy engine/runs.
			"packages/engine/src/runs/index.ts": "export {};\n",
			"scripts/capabilities.ts": MAP,
		},
		roots,
	);
}

/** A slice, a second use case and an adapter of `pkg`, as the docs show them. */
function generate(root: string, pkg: string): void {
	run(
		root,
		sliceSteps(root, {
			package: pkg,
			slice: "spend",
			about: "what the runs of a Space cost.",
			useCase: "show-spend",
			useCaseAbout: "Shows what the runs of a Space cost.",
		}),
	);
	const at = { package: pkg, slice: "spend" };
	run(
		root,
		useCaseSteps(root, {
			...at,
			useCase: "list-limits",
			about: "Lists the limits.",
		}),
	);
	run(
		root,
		adapterSteps(root, {
			...at,
			port: "SpendStore",
			tech: "drizzle",
			about: "The spend.",
		}),
	);
}

test("a template holds no Handlebars but {{{name}}}", () => {
	const files = readdirSync(TEMPLATES, { recursive: true, encoding: "utf8" });
	const templates = files.filter((file) => file.endsWith(".hbs"));
	expect(templates.length).toBe(11);
	for (const file of templates) {
		const rest = readFileSync(join(TEMPLATES, file), "utf8").replace(
			PLACEHOLDER,
			"",
		);
		expect({ file, braces: /\{\{|\}\}/.test(rest) }).toEqual({
			file,
			braces: false,
		});
	}
});

test("turbo gen has the three generators, and each file they add has its template", () => {
	const generators = new Map<string, PlopTypes.PlopGeneratorConfig>();
	generator({
		setGenerator: (name: string, config: PlopTypes.PlopGeneratorConfig) =>
			generators.set(name, config),
		getPlopfilePath: () => join(TEMPLATES, ".."),
	} as unknown as PlopTypes.NodePlopAPI);
	expect([...generators.keys()]).toEqual(["slice", "use-case", "adapter"]);

	const actions = generators.get("slice")?.actions;
	if (typeof actions !== "function") throw new Error("no slice generator");
	const actionsOf = (answers: PlopTypes.Answers) => actions(answers);
	// A capability that no server package will hold: the widgets of the phone.
	const slice = { slice: "widgets", about: "x", useCase: "show-widget" };
	const adds = actionsOf({ ...slice, package: "engine", useCaseAbout: "y" })
		.filter((action) => typeof action === "object" && action.type === "add")
		.map((action) => action as PlopTypes.AddActionConfig);
	expect(adds.length).toBe(6);
	for (const add of adds) {
		expect(add.path).toStartWith(
			join(TEMPLATES, "../../../packages/engine/src/widgets/"),
		);
		expect(existsSync(add.templateFile ?? "")).toBe(true);
	}
	// Answers that are not valid give one action, which fails with the reason.
	const refused = actionsOf({ ...slice, package: "auth", useCaseAbout: "y" });
	expect(refused.length).toBe(1);
	expect(() => (refused[0] as unknown as () => void)()).toThrow(
		"below the engine",
	);
});

test("the generators name files as the ring check does", () => {
	for (const name of ["SpendStore", "HTTPClient", "Clock", "RunLogV2"]) {
		expect(generatedKebab(name)).toBe(kebab(name));
	}
	for (const name of ["show-spend", "run-status", "a2-b"]) {
		expect(generatedCamel(name)).toBe(camel(name));
	}
});

describe("what the generators make keeps the ring check", () => {
	for (const pkg of ["engine", "devices"]) {
		test(`a slice of ${pkg} with two use cases and an adapter`, async () => {
			const root = repositoryWithMap();
			expect(await checkRings(root, OPTIONS)).toEqual([]);
			generate(root, pkg);
			const out = `packages/${pkg}/src/spend/adapters/out`;
			for (const file of [
				`${out}/drizzle-spend-store.ts`,
				`${out}/spend-store.contract.test.ts`,
				`packages/${pkg}/src/spend/application/list-limits.test.ts`,
			]) {
				expect(readFileSync(join(root, file), "utf8")).toContain("import");
			}
			expect(await checkRings(root, OPTIONS)).toEqual([]);
			const wire = readFileSync(
				join(root, `packages/${pkg}/src/spend/wire.ts`),
				"utf8",
			);
			expect(wire).toContain("\t\tlistLimits: listLimits(ports),\n");
			expect(wire).toContain("\t\tspendStore: drizzleSpendStore(),\n");
		});
	}
});

describe("the generators refuse, and write nothing", () => {
	const refusal = (make: () => unknown) => {
		try {
			make();
		} catch (error) {
			if (error instanceof GeneratorRefusal) return error.message;
			throw error;
		}
		return null;
	};
	const slice = {
		slice: "spend",
		about: "x",
		useCase: "show-spend",
		useCaseAbout: "y",
	};

	test("a package below the engine, a slice that is no capability, one that exists", () => {
		const root = repositoryWithMap();
		expect(
			refusal(() => sliceSteps(root, { ...slice, package: "auth" })),
		).toContain("below the engine");
		expect(
			refusal(() =>
				sliceSteps(root, { ...slice, package: "engine", slice: "billing" }),
			),
		).toContain("no capability");
		expect(
			refusal(() =>
				sliceSteps(root, { ...slice, package: "engine", slice: "gates" }),
			),
		).toContain("has a vertical gates already");
	});

	test("a use case or an adapter of a slice made by hand", () => {
		const root = repositoryWithMap();
		const at = { package: "engine", slice: SLICE.split("/").at(-1) ?? "" };
		expect(
			refusal(() =>
				useCaseSteps(root, { ...at, useCase: "pause-schedule", about: "x" }),
			),
		).toContain("has no port SchedulesAccess");
		expect(
			refusal(() =>
				adapterSteps(root, {
					...at,
					port: "ScheduleStore",
					tech: "drizzle",
					about: "x",
				}),
			),
		).toContain("has the port ScheduleStore already");
		expect(
			refusal(() =>
				adapterSteps(root, { ...at, port: "Clock", tech: "node", about: "x" }),
			),
		).toContain("Cannot find the ports of wireSchedules");
	});
});

describe("the edits", () => {
	test("a map line goes into its package, in name order, before the comment of the next entry", () => {
		const lines = withMapLine(MAP, "engine", "spend", "spend").split("\n");
		const at = lines.indexOf('\t\tspend: "spend",');
		const block = lines.indexOf('\t"packages/engine": {');
		expect(at).toBeGreaterThan(block);
		expect(lines.slice(block, at).includes("\t},")).toBe(false);
		expect(lines[at - 1]).toBe('\t\t"space-move": "space-move",');
		expect(lines[at + 1]?.startsWith("\t\t//")).toBe(true);
		expect(() => withMapLine(MAP, "engine", "gates", "gates")).toThrow(
			GeneratorRefusal,
		);
	});

	test("a member joins a literal on one line", () => {
		const text =
			"function wireX() {\n\tconst ports = { access: deps.access };\n}";
		expect(
			withMember(
				text,
				{ opener: /^\tconst ports = \{/ },
				["store: store(),"],
				"ports",
			),
		).toBe(
			"function wireX() {\n\tconst ports = {\n\t\taccess: deps.access,\n\t\tstore: store(),\n\t};\n}",
		);
	});
});
