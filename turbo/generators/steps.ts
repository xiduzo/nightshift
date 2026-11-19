/**
 * What each generator does, as a list of steps: the files it adds from a
 * template, the files it changes, and the format at the end. `config.ts`
 * hands the steps to plop. `scripts/generators.test.ts` runs them on a
 * small repository and asks the ring check about the result.
 *
 * A step list is made only when every answer is valid. Else it throws a
 * `GeneratorRefusal` that says what to change, and nothing is written.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SERVER_PACKAGES } from "../../.dependency-cruiser.mjs";
import { CAPABILITIES, VERTICALS } from "../../scripts/capabilities";
import { GeneratorRefusal, withImport, withMapLine, withMember } from "./edits";

/** The values a template reads. */
export type Data = Record<string, string>;

/** One thing a generator does, in order. A path is relative to the repository root. */
export type Step =
	/** A new file from a template of `templates/`. */
	| { kind: "add"; path: string; template: string; data: Data }
	/** A template of `templates/` added at the end of a file. */
	| { kind: "append"; path: string; template: string; data: Data }
	/** A change to a file. */
	| { kind: "edit"; path: string; edit: (text: string) => string }
	/** Biome formats and sorts these files. */
	| { kind: "format"; paths: string[] };

/** The answers of `turbo gen slice`. */
export type SliceAnswers = {
	package: string;
	slice: string;
	about: string;
	useCase: string;
	useCaseAbout: string;
};

/** The answers of `turbo gen use-case`. */
export type UseCaseAnswers = {
	package: string;
	slice: string;
	useCase: string;
	about: string;
};

/** The answers of `turbo gen adapter`. */
export type AdapterAnswers = {
	package: string;
	slice: string;
	port: string;
	tech: string;
	about: string;
};

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;

/** `show-spend` is `showSpend`. The ring check names files the same way. */
export const camel = (name: string): string =>
	name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

/** `space-move` is `SpaceMove`. */
export const pascal = (name: string): string =>
	camel(name).replace(/^[a-z]/, (letter) => letter.toUpperCase());

/** `SpendStore` is `spend-store`, `HTTPClient` is `http-client`. */
export const kebab = (name: string): string =>
	name
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.toLowerCase();

/**
 * Where a slice of each package takes the `Actor` from, as seen from
 * `application/` and from `adapters/out/`. `agents` and `auth` are below
 * the engine: their use cases have no `Actor` yet.
 */
const ACTOR: Record<string, { application: string; adapters: string }> = {
	engine: { application: "../../contract", adapters: "../../../contract" },
	devices: {
		application: "@nightshift/engine",
		adapters: "@nightshift/engine",
	},
	notifications: {
		application: "@nightshift/engine",
		adapters: "@nightshift/engine",
	},
	telemetry: {
		application: "@nightshift/engine",
		adapters: "@nightshift/engine",
	},
};

const refuse = (message: string): never => {
	throw new GeneratorRefusal(message);
};

/** A sentence for a comment: trimmed, with its full stop. */
function sentence(text: string, what: string): string {
	const words = text.trim();
	if (!words) refuse(`Write ${what} in one sentence.`);
	return /[.!?]$/.test(words) ? words : `${words}.`;
}

/** The package, checked: a server package whose use cases take an `Actor`. */
function serverPackage(pkg: string) {
	if (!SERVER_PACKAGES.includes(pkg)) {
		refuse(
			`"${pkg}" is no server package. Pick one of ${SERVER_PACKAGES.join(", ")}.`,
		);
	}
	const actor = ACTOR[pkg];
	if (!actor) {
		return refuse(
			`${pkg} is below the engine, so its use cases have no Actor yet. Shape this slice by hand (docs/steering/STRUCTURE.md, section 9).`,
		);
	}
	return actor;
}

/** The paths of a slice, from the repository root. */
function sliceDir(pkg: string, slice: string) {
	const dir = `packages/${pkg}/src/${slice}`;
	return {
		dir,
		wire: `${dir}/wire.ts`,
		ports: `${dir}/application/ports.ts`,
		neighbours: `${dir}/adapters/out/in-memory-neighbours.ts`,
	};
}

/** Where the use cases and the twins of a slice are listed, for the edits. */
function anchors(slice: string) {
	const name = pascal(slice);
	return {
		wireFunction: new RegExp(`^export function wire${name}\\(`),
		useCases: new RegExp(`^export type ${name} = \\{`),
		ports: /^\tconst ports = \{/,
		returned: /^\treturn \{/,
		twins: new RegExp(`^export function inMemory${name}Ports\\(`),
	};
}

/** The use case's names, checked against the files of `slice`. */
function useCaseData(root: string, pkg: string, slice: string, name: string) {
	if (!KEBAB.test(name) || !name.includes("-")) {
		refuse(
			`Name a use case <verb>-<object> in lower case with dashes (answer-gate), not "${name}".`,
		);
	}
	const path = `${sliceDir(pkg, slice).dir}/application/${name}.ts`;
	if (existsSync(join(root, path))) refuse(`${path} exists already.`);
	return {
		path,
		data: {
			useCase: name,
			useCaseCamel: camel(name),
			useCasePascal: pascal(name),
		},
	};
}

/** The steps that add a use case to a slice: its file, its test, and its line in `wire.ts`. */
function useCaseFiles(
	pkg: string,
	slice: string,
	useCase: { path: string; data: Data },
	data: Data,
): { steps: Step[]; paths: string[] } {
	const paths = sliceDir(pkg, slice);
	const at = anchors(slice);
	const { useCaseCamel, useCase: name } = useCase.data;
	const test = useCase.path.replace(/\.ts$/, ".test.ts");
	const all = { ...data, ...useCase.data };
	const editWire = (text: string) =>
		withMember(
			withMember(
				withImport(
					text,
					`import { ${useCaseCamel} } from "./application/${name}";`,
				),
				{ opener: at.useCases },
				[
					`/** ${all.useCaseAbout} */`,
					`${useCaseCamel}: ReturnType<typeof ${useCaseCamel}>;`,
				],
				`the type ${pascal(slice)} in ${paths.wire}`,
			),
			{ opener: at.returned, after: at.wireFunction },
			[`${useCaseCamel}: ${useCaseCamel}(ports),`],
			`the return of wire${pascal(slice)} in ${paths.wire}`,
		);
	return {
		steps: [
			{
				kind: "add",
				path: useCase.path,
				template: "use-case/use-case.ts.hbs",
				data: all,
			},
			{
				kind: "add",
				path: test,
				template: "use-case/use-case.test.ts.hbs",
				data: all,
			},
			{ kind: "edit", path: paths.wire, edit: editWire },
		],
		paths: [useCase.path, test, paths.wire],
	};
}

/** The data every template of a slice reads. */
function sliceData(pkg: string, slice: string): Data {
	const actor = serverPackage(pkg);
	return {
		package: pkg,
		slice,
		sliceTitle: slice
			.replace(/^[a-z]/, (letter) => letter.toUpperCase())
			.replace(/-/g, " "),
		slicePascal: pascal(slice),
		actorFromApplication: actor.application,
		actorFromAdapters: actor.adapters,
	};
}

/**
 * Fails when the slice lacks what a generated use case stands on: the port
 * `<Slice>Access` and the twins `inMemory<Slice>Ports`. A slice that
 * `turbo gen slice` started has both.
 */
function checkAccess(root: string, pkg: string, slice: string) {
	const paths = sliceDir(pkg, slice);
	const name = pascal(slice);
	const needs = [
		{ path: paths.ports, what: `port ${name}Access`, line: "export type" },
		{
			path: paths.neighbours,
			what: `function inMemory${name}Ports`,
			line: "export function",
		},
	];
	for (const { path, what, line } of needs) {
		const full = join(root, path);
		const word = what.split(" ").at(-1);
		const text = existsSync(full) ? readFileSync(full, "utf8") : "";
		if (!new RegExp(`^${line} ${word}\\b`, "m").test(text)) {
			refuse(
				`${path} has no ${what}: a generated use case asks it who may act. Start the slice with "turbo gen slice", or write this use case by hand (docs/steering/STRUCTURE.md, section 9).`,
			);
		}
	}
}

/** Fails when a file of a slice is not the shape the generators made. */
function checkEdit(root: string, path: string, edit: (text: string) => string) {
	const full = join(root, path);
	if (!existsSync(full)) {
		refuse(
			`${path} does not exist. Start the slice with "turbo gen slice", or add this by hand (docs/steering/STRUCTURE.md, section 9).`,
		);
	}
	try {
		edit(readFileSync(full, "utf8"));
	} catch (error) {
		if (!(error instanceof GeneratorRefusal)) throw error;
		refuse(`${error.message} Add it by hand.`);
	}
}

/** The steps of `turbo gen slice`: a new capability slice with its first use case. */
export function sliceSteps(root: string, answers: SliceAnswers): Step[] {
	const { package: pkg, slice } = answers;
	const data = sliceData(pkg, slice);
	if (!KEBAB.test(slice)) {
		refuse(
			`Name a slice in lower case with dashes (space-move), not "${slice}".`,
		);
	}
	if (!(slice in CAPABILITIES)) {
		refuse(
			`"${slice}" is no capability of scripts/capabilities.ts. A slice has the name of its capability. Add the capability to CAPABILITIES first, with its word of docs/glossary.md.`,
		);
	}
	const paths = sliceDir(pkg, slice);
	if (
		VERTICALS[`packages/${pkg}`]?.[slice] ||
		existsSync(join(root, paths.dir))
	) {
		refuse(`packages/${pkg} has a vertical ${slice} already.`);
	}
	const all = {
		...data,
		about: sentence(answers.about, "what the slice is"),
		useCaseAbout: sentence(answers.useCaseAbout, "what the use case does"),
	};
	const useCase = useCaseData(root, pkg, slice, answers.useCase);
	const first = useCaseFiles(pkg, slice, useCase, all);
	const added = [
		{ path: `${paths.dir}/index.ts`, template: "slice/index.ts.hbs" },
		{ path: paths.wire, template: "slice/wire.ts.hbs" },
		{ path: paths.ports, template: "slice/ports.ts.hbs" },
		{ path: paths.neighbours, template: "slice/in-memory-neighbours.ts.hbs" },
	];
	const map = "scripts/capabilities.ts";
	return [
		...added.map((file): Step => ({ kind: "add", ...file, data: all })),
		{
			kind: "edit",
			path: map,
			edit: (text) => withMapLine(text, pkg, slice, slice),
		},
		...first.steps,
		{
			kind: "format",
			paths: [
				...new Set([...added.map((file) => file.path), map, ...first.paths]),
			],
		},
	];
}

/** The steps of `turbo gen use-case`: one more use case in a slice the generator started. */
export function useCaseSteps(root: string, answers: UseCaseAnswers): Step[] {
	const { package: pkg, slice } = answers;
	const data = {
		...sliceData(pkg, slice),
		useCaseAbout: sentence(answers.about, "what the use case does"),
	};
	const useCase = useCaseData(root, pkg, slice, answers.useCase);
	checkAccess(root, pkg, slice);
	const { steps, paths } = useCaseFiles(pkg, slice, useCase, data);
	for (const step of steps) {
		if (step.kind === "edit") checkEdit(root, step.path, step.edit);
	}
	return [...steps, { kind: "format", paths }];
}

/**
 * The steps of `turbo gen adapter`: a new port of a slice, with its real
 * adapter, its in-memory twin, its contract suite and the test that runs
 * the suite on both.
 */
export function adapterSteps(root: string, answers: AdapterAnswers): Step[] {
	const { package: pkg, slice, port, tech } = answers;
	const data = sliceData(pkg, slice);
	if (!PASCAL.test(port)) {
		refuse(`Name a port in PascalCase (ScheduleStore), not "${port}".`);
	}
	if (!KEBAB.test(tech) || tech === "in-memory" || tech === "in") {
		refuse(
			`Name the technology of the real adapter in lower case with dashes (drizzle, node, flow-document), not "${tech}".`,
		);
	}
	const paths = sliceDir(pkg, slice);
	const portsFile = join(root, paths.ports);
	if (
		existsSync(portsFile) &&
		new RegExp(`^export (?:type|interface) ${port}\\b`, "m").test(
			readFileSync(portsFile, "utf8"),
		)
	) {
		refuse(
			`${paths.ports} has the port ${port} already. The generator starts a new port with its adapters: write the adapters of this one by hand.`,
		);
	}
	const name = kebab(port);
	const out = `${paths.dir}/adapters/out`;
	const real = `${camel(tech)}${port}`;
	const all = {
		...data,
		about: sentence(answers.about, "what the port does"),
		port,
		portKebab: name,
		portCamel: camel(name),
		tech,
		real,
		realFile: `${tech}-${name}`,
	};
	const files = [
		{
			path: `${out}/in-memory-${name}.ts`,
			template: "adapter/in-memory.ts.hbs",
		},
		{ path: `${out}/${tech}-${name}.ts`, template: "adapter/real.ts.hbs" },
		{ path: `${out}/${name}.contract.ts`, template: "adapter/contract.ts.hbs" },
		{
			path: `${out}/${name}.contract.test.ts`,
			template: "adapter/contract.test.ts.hbs",
		},
	];
	for (const file of files) {
		if (existsSync(join(root, file.path)))
			refuse(`${file.path} exists already.`);
	}
	const at = anchors(slice);
	const editWire = (text: string) =>
		withMember(
			withImport(
				text,
				`import { ${real} } from "./adapters/out/${tech}-${name}";`,
			),
			{ opener: at.ports, after: at.wireFunction },
			[`${all.portCamel}: ${real}(),`],
			`the ports of wire${pascal(slice)} in ${paths.wire}`,
		);
	const editTwins = (text: string) =>
		withMember(
			withImport(
				text,
				`import { inMemory${port} } from "./in-memory-${name}";`,
			),
			{ opener: at.returned, after: at.twins },
			[`${all.portCamel}: inMemory${port}(),`],
			`the return of inMemory${pascal(slice)}Ports in ${paths.neighbours}`,
		);
	checkEdit(root, paths.wire, editWire);
	checkEdit(root, paths.neighbours, editTwins);
	checkEdit(root, paths.ports, (text) => text);
	return [
		{
			kind: "append",
			path: paths.ports,
			template: "adapter/port.ts.hbs",
			data: all,
		},
		...files.map((file): Step => ({ kind: "add", ...file, data: all })),
		{ kind: "edit", path: paths.wire, edit: editWire },
		{ kind: "edit", path: paths.neighbours, edit: editTwins },
		{
			kind: "format",
			paths: [
				paths.ports,
				...files.map((file) => file.path),
				paths.wire,
				paths.neighbours,
			],
		},
	];
}
