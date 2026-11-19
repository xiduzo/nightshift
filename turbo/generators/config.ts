/**
 * The generators of Night Shift (`turbo gen`). A new slice, use case or
 * adapter of a server package starts from one of them (H11 of the hexagon
 * series). What they make keeps the ring check from the first commit:
 * docs/steering/STRUCTURE.md, section 9, says how to run them.
 *
 *   bun run gen slice    --args <package> <slice> "<what it is>" <verb-object> "<what it does>"
 *   bun run gen use-case --args <package> <slice> <verb-object> "<what it does>"
 *   bun run gen adapter  --args <package> <slice> <Port> <tech> "<what the port does>"
 *
 * Without `--args`, each asks its questions. `steps.ts` holds what each
 * generator does, `templates/` the files it writes.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PlopTypes } from "@turbo/gen";

import { SERVER_PACKAGES } from "../../.dependency-cruiser.mjs";
import { GeneratorRefusal } from "./edits";
import { adapterSteps, type Step, sliceSteps, useCaseSteps } from "./steps";

type Question = PlopTypes.PromptQuestion;

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A question whose answer must match `pattern`. */
const ask = (name: string, message: string, pattern?: RegExp): Question => ({
	type: "input",
	name,
	message,
	validate: (answer: string) =>
		(pattern ? pattern.test(answer) : answer.trim().length > 0) ||
		`Not valid: "${answer}". ${message}`,
});

const PACKAGE: Question = {
	type: "list",
	name: "package",
	message: "Which server package?",
	choices: SERVER_PACKAGES,
};

const SLICE = ask(
	"slice",
	"Which slice (its capability, in lower case)?",
	KEBAB,
);

/**
 * The actions of one run: the steps of `make`, or one action that fails
 * with the reason when the answers are not valid.
 */
function actionsOf(
	plop: PlopTypes.NodePlopAPI,
	make: (root: string, answers: PlopTypes.Answers) => Step[],
): PlopTypes.DynamicActionsFunction {
	// This file is turbo/generators/config.ts: the repository is two up.
	const root = resolve(plop.getPlopfilePath(), "..", "..");
	const templates = join(plop.getPlopfilePath(), "templates");
	return (answers = {}) => {
		try {
			return make(root, answers).map((step) =>
				actionOf(plop, root, templates, step),
			);
		} catch (error) {
			if (!(error instanceof GeneratorRefusal)) throw error;
			const reason = error.message;
			return [
				() => {
					throw new Error(reason);
				},
			];
		}
	};
}

function actionOf(
	plop: PlopTypes.NodePlopAPI,
	root: string,
	templates: string,
	step: Step,
): PlopTypes.ActionType {
	switch (step.kind) {
		case "add":
			return {
				type: "add",
				path: join(root, step.path),
				templateFile: join(templates, step.template),
				data: step.data,
				abortOnFail: true,
			};
		case "append":
			return () => {
				const path = join(root, step.path);
				const template = readFileSync(join(templates, step.template), "utf8");
				const text = readFileSync(path, "utf8");
				writeFileSync(
					path,
					`${text}\n${plop.renderString(template, step.data)}`,
				);
				return `${step.path} (append)`;
			};
		case "edit":
			return () => {
				const path = join(root, step.path);
				writeFileSync(path, step.edit(readFileSync(path, "utf8")));
				return `${step.path} (edit)`;
			};
		case "format":
			return () => format(root, step.paths);
	}
}

/** Biome formats the files and sorts their imports, as the pre-commit hook does. */
function format(root: string, paths: string[]): string {
	const biome = join(root, "node_modules", ".bin", "biome");
	if (!existsSync(biome)) {
		throw new Error("Biome is not installed here. Run `bun install` first.");
	}
	const run = spawnSync(biome, ["check", "--write", ...paths], {
		cwd: root,
		encoding: "utf8",
	});
	if (run.status !== 0) {
		throw new Error(`Biome found a problem:\n${run.stdout}${run.stderr}`);
	}
	return `${paths.length} files (biome check --write)`;
}

export default function generator(plop: PlopTypes.NodePlopAPI): void {
	plop.setGenerator("slice", {
		description:
			"A new capability slice of a server package, in rings, with its first use case",
		prompts: [
			PACKAGE,
			SLICE,
			ask("about", "What is the slice, in one sentence?"),
			ask("useCase", "Its first use case (<verb>-<object>)?", KEBAB),
			ask("useCaseAbout", "What does the use case do, in one sentence?"),
		],
		actions: actionsOf(plop, (root, answers) =>
			sliceSteps(root, {
				package: answers.package,
				slice: answers.slice,
				about: answers.about,
				useCase: answers.useCase,
				useCaseAbout: answers.useCaseAbout,
			}),
		),
	});

	plop.setGenerator("use-case", {
		description: "One more use case in a slice, with its test",
		prompts: [
			PACKAGE,
			SLICE,
			ask("useCase", "Which use case (<verb>-<object>)?", KEBAB),
			ask("about", "What does it do, in one sentence?"),
		],
		actions: actionsOf(plop, (root, answers) =>
			useCaseSteps(root, {
				package: answers.package,
				slice: answers.slice,
				useCase: answers.useCase,
				about: answers.about,
			}),
		),
	});

	plop.setGenerator("adapter", {
		description:
			"A new port of a slice, with its real adapter, its in-memory twin and its contract suite",
		prompts: [
			PACKAGE,
			SLICE,
			ask("port", "Which port (PascalCase)?", /^[A-Z][A-Za-z0-9]*$/),
			ask(
				"tech",
				"What does the real adapter use (drizzle, node, git)?",
				KEBAB,
			),
			ask("about", "What does the port do, in one sentence?"),
		],
		actions: actionsOf(plop, (root, answers) =>
			adapterSteps(root, {
				package: answers.package,
				slice: answers.slice,
				port: answers.port,
				tech: answers.tech,
				about: answers.about,
			}),
		),
	});
}
