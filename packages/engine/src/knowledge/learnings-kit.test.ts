import { afterEach, describe, expect, test } from "bun:test";
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	formatLearnings,
	parseLearnings,
	proposedLearningAt,
	REVIEW_LEARNINGS_KIT,
} from "@nightshift/flows";
import { kitCommand } from "@nightshift/flows/testing";
import { Refusal } from "@nightshift/refusal";
import { createLearnings } from "./learnings";

/**
 * The two forms of keep and delete: the TypeScript of the Learnings module,
 * and the shell of `kit:knowledge/review-learnings`, which runs where no
 * TypeScript does. Each case runs both over the same folder, with the real
 * `/bin/sh` and the command as a step renders it, and asks for the same
 * folder after them. What TypeScript refuses, the shell skips.
 */

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

/** A knowledge folder as a list of files, by path. A path that ends in `/` is an empty folder. */
type Tree = Record<string, string>;

async function folderOf(tree: Tree): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "nightshift-learnings-"));
	roots.push(root);
	const knowledge = join(root, "knowledge");
	await mkdir(join(knowledge, "learnings", "proposed"), { recursive: true });
	for (const [path, text] of Object.entries(tree)) {
		if (path.endsWith("/")) {
			await mkdir(join(knowledge, path), { recursive: true });
			continue;
		}
		await mkdir(dirname(join(knowledge, path)), { recursive: true });
		await writeFile(join(knowledge, path), text);
	}
	return knowledge;
}

/** Every folder and file under `dir`, with the text of each file, by path. */
async function treeOf(dir: string, under = ""): Promise<Tree> {
	const tree: Tree = {};
	for (const name of (await readdir(dir)).sort()) {
		const path = `${under}${name}`;
		if ((await lstat(join(dir, name))).isDirectory()) {
			tree[`${path}/`] = "";
			Object.assign(tree, await treeOf(join(dir, name), `${path}/`));
		} else {
			tree[path] = await readFile(join(dir, name), "utf8");
		}
	}
	return tree;
}

/** The kit's command of a node, as a step renders it with this output of `list`. */
function rendered(nodeId: string, files: string) {
	return kitCommand(REVIEW_LEARNINGS_KIT, nodeId, {
		list: { data: { files } },
	});
}

/** Runs a command in the shell of a step. Its cwd holds the same names as the folder, so a pattern would find them. */
async function inShell(
	knowledge: string,
	command: string,
	env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
	const output = join(dirname(knowledge), "output.json");
	await writeFile(output, "");
	const proc = Bun.spawn(["/bin/sh", "-c", command], {
		cwd: join(knowledge, "learnings", "proposed"),
		env: {
			PATH: process.env.PATH ?? "",
			...env,
			NS_KNOWLEDGE: knowledge,
			NS_OUTPUT: output,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [err, code] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Error(`The shell failed: ${err}`);
	return { code, output: await readFile(output, "utf8") };
}

/** The Learnings module over one folder, with the document listing nothing unless told. */
function learningsOver(
	knowledge: string,
	listed: ReadonlyMap<
		string,
		{ sha256: string; changedAt: number }
	> = new Map(),
) {
	return createLearnings({
		folders: { folder: () => knowledge },
		documents: {
			open: async () => ({ entries: () => listed }) as never,
		},
		archive: {
			read: async ({ sha256 }: { sha256?: string }) =>
				sha256 ? new Uint8Array(await readFile(join(knowledge, sha256))) : null,
		} as never,
		status: { spaceOf: async () => "space", heard: () => {} },
		startStep: async () => ({ done: async () => {} }),
		notifications: { learningsChanged: async () => {} },
	});
}

const NEW_FILE = formatLearnings(["One.", "Two."], {
	runId: "run-1",
	isNew: true,
});

/** What each case starts from: the id both are asked to settle, and the folder. */
const SETTLED: { name: string; id: string; tree: Tree }[] = [
	{
		name: "a step's file",
		id: "run-1.s1.md",
		tree: { "learnings/proposed/run-1.s1.md": NEW_FILE },
	},
	{
		name: "a run's file from before steps had files",
		id: "run-1.md",
		tree: { "learnings/proposed/run-1.md": NEW_FILE },
	},
	{
		name: "a file of a Command",
		id: "sweep.2026-11-04.md",
		tree: { "learnings/proposed/sweep.2026-11-04.md": "Prose.\n- One.\n" },
	},
	{
		name: "an empty folder of accepted learnings",
		id: "run-1.s1.md",
		tree: {
			"learnings/proposed/run-1.s1.md": NEW_FILE,
			"learnings/accepted/": "",
		},
	},
	{
		name: "an empty accepted file",
		id: "run-1.s1.md",
		tree: {
			"learnings/proposed/run-1.s1.md": NEW_FILE,
			"learnings/accepted/run-1.s1.md": "",
		},
	},
	{
		name: "an accepted file to add to",
		id: "run-1.s1.md",
		tree: {
			"learnings/proposed/run-1.s1.md": "- Later.\n",
			"learnings/accepted/run-1.s1.md": "- Kept before.\n",
			"learnings/accepted/other.md": "- Stays.\n",
		},
	},
	{
		name: "an accepted file without a last line break",
		id: "run-1.s1.md",
		tree: {
			"learnings/proposed/run-1.s1.md": "- Later.\n",
			"learnings/accepted/run-1.s1.md": "- Kept before.",
		},
	},
	{
		name: "a file beside other proposals",
		id: "run-1.s1.md",
		tree: {
			"learnings/proposed/run-1.s1.md": NEW_FILE,
			"learnings/proposed/run-2.s1.md": "- Stays.\n",
		},
	},
];

/** Names that are no proposed learning: TypeScript refuses them, and the shell leaves all as it is. */
const REFUSED: { name: string; id: string; tree?: Tree }[] = [
	// Dots.
	...[".", "..", ".md", "..md", ".hidden.md", "a..md", "a.b.c.md", "a.md."].map(
		(id) => ({ name: `the dot name ${id}`, id }),
	),
	// Other marks, on a real file with that name.
	...[
		"-dash.md",
		"_under.md",
		"a.-b.md",
		"a._b.md",
		"a;b.md",
		"a&b.md",
		"a'b.md",
		'a"b.md',
		"a$b.md",
		"$(touch pwned).md",
		"a*b.md",
		"ünï.md",
		"UPPER.MD",
		"notes.txt",
		"no-extension",
	].map((id) => ({
		name: `the weird name ${id}`,
		id,
		tree: { [`learnings/proposed/${id}`]: "- Stays.\n" },
	})),
	// A name that is a pattern of the files beside it.
	{
		name: "a pattern",
		id: "*.md",
		tree: { "learnings/proposed/real.md": "- Stays.\n" },
	},
	{
		name: "the pattern ?.md",
		id: "?.md",
		tree: { "learnings/proposed/a.md": "- Stays.\n" },
	},
	// Folders.
	{
		name: "a file in a subfolder",
		id: "sub/x.md",
		tree: { "learnings/proposed/sub/x.md": "- Stays.\n" },
	},
	{
		name: "a path out of the folder",
		id: "../x.md",
		tree: { "learnings/x.md": "- Stays.\n" },
	},
	{
		name: "a path further out of the folder",
		id: "../../evil.md",
		tree: { "evil.md": "- Stays.\n" },
	},
	{
		name: "a folder with a proposal's name",
		id: "dir.md",
		tree: { "learnings/proposed/dir.md/x": "- Stays.\n" },
	},
	// Spaces: each word is its own name to the shell, and none is a file.
	{
		name: "a name with a space",
		id: "my notes.md",
		tree: { "learnings/proposed/my notes.md": "- Stays.\n" },
	},
	{
		name: "a proposal that no longer waits",
		id: "gone.md",
		tree: { "learnings/proposed/other.md": "- Stays.\n" },
	},
];

describe.each(["keep", "delete"] as const)("%s, in both forms", (decision) => {
	/** The same folder twice, one for each form. The folder they left must be the same. */
	async function both(id: string, tree: Tree) {
		const inTypeScript = await folderOf(tree);
		const refusal = await learningsOver(inTypeScript)
			.settle("p1", id, decision)
			.then(
				() => null,
				(error: unknown) => error,
			);

		const byShell = await folderOf(tree);
		const { command, env } = rendered(decision, id);
		await inShell(byShell, command, env);

		const left = await treeOf(inTypeScript);
		expect(await treeOf(byShell)).toEqual(left);
		return { refusal, left };
	}

	test.each(SETTLED)("settles $name the same", async ({ id, tree }) => {
		const { refusal, left } = await both(id, tree);
		expect(refusal).toBeNull();
		const path = `learnings/proposed/${id}`;
		expect(left).not.toHaveProperty([path]);
		const accepted = `learnings/accepted/${id}`;
		if (decision === "keep") {
			expect(left[accepted]).toBe(`${tree[accepted] ?? ""}${tree[path]}`);
		} else {
			expect(left[accepted]).toBe(tree[accepted] as never);
		}
	});

	test.each(REFUSED)("refuses $name the same", async ({ id, tree = {} }) => {
		const { refusal, left } = await both(id, tree);
		expect(refusal).toBeInstanceOf(Refusal);
		expect((refusal as Refusal).kind).toBe("not-found");
		expect(left).toEqual(await treeOf(await folderOf(tree)));
	});

	test("settles only what the Gate listed, and a name more changes nothing else", async () => {
		const knowledge = await folderOf({
			"learnings/proposed/a.md": "- A.\n",
			"learnings/proposed/b.md": "- B.\n",
			"learnings/proposed/my notes.md": "- Spaces.\n",
		});
		const { command, env } = rendered(decision, " a.md ../b.md .hidden.md");
		await inShell(knowledge, command, env);
		const left = await treeOf(knowledge);
		expect(Object.keys(left)).toEqual(
			[
				"learnings/",
				...(decision === "keep"
					? ["learnings/accepted/", "learnings/accepted/a.md"]
					: []),
				"learnings/proposed/",
				"learnings/proposed/b.md",
				"learnings/proposed/my notes.md",
			].sort(),
		);
	});
});

describe("what the Gate lists", () => {
	/** A folder with every kind of file, as a document lists it. */
	const tree: Tree = {
		"learnings/proposed/run-1.s1.md": NEW_FILE,
		"learnings/proposed/run-2.md": formatLearnings(["Three."], {
			runId: "run-2",
			isNew: true,
		}),
		"learnings/proposed/sweep.2026-11-04.md": "- Four.\n",
		"learnings/proposed/.hidden.md": "- Hidden.\n",
		"learnings/proposed/my notes.md": "- Spaces.\n",
		"learnings/proposed/a.b.c.md": "- Three parts.\n",
		"learnings/proposed/sub/deep.md": "- Deep.\n",
		"learnings/proposed/notes.txt": "- Not markdown.\n",
	};

	test("is what the review page lists, with the same notes", async () => {
		const knowledge = await folderOf(tree);
		const { command, env } = rendered("list", "");
		const { output } = await inShell(knowledge, command, env);
		const gate = JSON.parse(output) as { files: string; text: string };

		const listed = new Map(
			Object.keys(tree).map((path) => [
				path,
				{ sha256: path, changedAt: path.length },
			]),
		);
		const waiting = await learningsOver(knowledge, listed).waiting("p1");
		expect(gate.files.trim().split(" ").sort()).toEqual(
			waiting.map(({ id }) => id).sort(),
		);
		expect(parseLearnings(gate.text).sort()).toEqual(
			waiting.flatMap(({ notes }) => notes).sort(),
		);
		expect(gate.text).not.toContain("Learnings of run");
		expect(gate.text).not.toContain("proposed to learn");
		// The rule of the page, for each file.
		expect(
			Object.keys(tree).filter((path) => proposedLearningAt(path)).length,
		).toBe(waiting.length);
	});

	test("keeps backslashes and quotes of a note, as valid JSON", async () => {
		const note = String.raw`- C:\temp\new says "stop" at \\host`;
		const knowledge = await folderOf({
			"learnings/proposed/run-1.s1.md": `${note}\n`,
		});
		const { command, env } = rendered("list", "");
		const { output } = await inShell(knowledge, command, env);

		const gate = JSON.parse(output) as { text: string };
		expect(gate.text).toBe(`${note}\n`);
	});

	test("has nothing for a folder of other files: no Gate opens", async () => {
		const knowledge = await folderOf({
			"learnings/proposed/my notes.md": "- Spaces.\n",
			"learnings/proposed/sub/deep.md": "- Deep.\n",
		});
		const { command, env } = rendered("list", "");
		const { output } = await inShell(knowledge, command, env);
		expect(JSON.parse(output)).toEqual({ outcome: "none" });
	});

	test("goes from list to Keep over a name with spaces and its last word", async () => {
		const knowledge = await folderOf({
			"learnings/proposed/my notes.md": "- Spaces.\n",
			"learnings/proposed/notes.md": "- One word.\n",
		});
		const list = rendered("list", "");
		const { output } = await inShell(knowledge, list.command, list.env);
		const { files } = JSON.parse(output) as { files: string };
		expect(files).toBe(" notes.md");
		const keep = rendered("keep", files);
		await inShell(knowledge, keep.command, keep.env);
		const left = await treeOf(knowledge);
		expect(left["learnings/accepted/notes.md"]).toBe("- One word.\n");
		expect(left["learnings/proposed/my notes.md"]).toBe("- Spaces.\n");
		expect(left).not.toHaveProperty(["learnings/proposed/notes.md"]);
	});
});

/**
 * A project can hold a copy of the kit from before: "Copy into project" saves
 * the commands as they were then, and nothing updates them. These are those
 * commands, as they shipped until the kit's shell came from one rule. Nothing
 * in the folder changed for them: they keep working.
 */
describe("a copy of the kit from before", () => {
	const START = `set -e
if [ -z "$NS_KNOWLEDGE" ]; then echo "Run this kit in a flow: the step gets the project's knowledge folder there." >&2; exit 2; fi
proposed="$NS_KNOWLEDGE/learnings/proposed"
accepted="$NS_KNOWLEDGE/learnings/accepted"`;
	const OLD = {
		list: String.raw`${START}
files=""
for file in "$proposed"/*.md; do
	[ -f "$file" ] || continue
	files="$files $(basename "$file")"
done
if [ -z "$files" ]; then
	printf '{"outcome": "none"}' > "$NS_OUTPUT"
	exit 0
fi
text=$(cd "$proposed" && cat $files | awk 'BEGIN { ORS = "" } { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, " "); print $0 "\\n" }')
printf '{"files": "%s", "text": "%s"}' "$files" "$text" > "$NS_OUTPUT"`,
		keep: `${START}
mkdir -p "$accepted"
for name in $FILES; do
	case "$name" in */*|.*) continue ;; esac
	[ -f "$proposed/$name" ] || continue
	cat "$proposed/$name" >> "$accepted/$name"
	rm -f "$proposed/$name"
done`,
		delete: `${START}
for name in $FILES; do
	case "$name" in */*|.*) continue ;; esac
	rm -f "$proposed/$name"
done`,
	};

	test("reads what Night Shift writes today, and shows its header as it always did", async () => {
		const knowledge = await folderOf({
			"learnings/proposed/run-1.s1.md": NEW_FILE,
		});
		const { output } = await inShell(knowledge, OLD.list);
		const gate = JSON.parse(output) as { files: string; text: string };
		expect(gate.files).toBe(" run-1.s1.md");
		expect(gate.text).toBe(NEW_FILE);
	});

	test.each(["keep", "delete"] as const)(
		"%s leaves the folder as the new form does",
		async (decision) => {
			for (const { id, tree } of SETTLED) {
				const old = await folderOf(tree);
				await inShell(old, OLD[decision], { FILES: id });
				const current = await folderOf(tree);
				const { command, env } = rendered(decision, id);
				await inShell(current, command, env);
				const files = (left: Tree) =>
					Object.fromEntries(
						Object.entries(left).filter(([path]) => !path.endsWith("/")),
					);
				expect(files(await treeOf(old))).toEqual(files(await treeOf(current)));
			}
		},
	);
});
