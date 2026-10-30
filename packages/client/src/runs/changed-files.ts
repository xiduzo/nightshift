import { projectPath } from "./project-path";
import {
	type AgentToolCall,
	isRecord,
	jsonResult,
	stringField,
	toolName,
} from "./tool-input";

/**
 * One change an agent made to a file: text it replaced, a whole new
 * content, a patch in unified-diff lines, a delete, or a change the harness
 * gave no detail of (Codex names the file only).
 */
export type FileChange =
	| { kind: "edit"; before: string; after: string }
	| { kind: "write"; content: string }
	| { kind: "patch"; diff: string }
	| { kind: "delete" }
	| { kind: "unknown" };

/** A file the step changed, with every change in call order. */
export type ChangedFile = {
	/** Relative to the project when the file is inside it. */
	path: string;
	status: "added" | "edited" | "deleted";
	changes: FileChange[];
};

/** One change to one path, and whether it made the file (undefined: not known). */
type Touch = { path: string; change: FileChange; creates?: boolean };

const PATH_KEYS = [
	"file_path",
	"filePath",
	"path",
	"notebook_path",
	"target_file",
	"absolute_path",
] as const;
const BEFORE_KEYS = ["old_string", "oldString", "oldText", "old_str"] as const;
const AFTER_KEYS = ["new_string", "newString", "newText", "new_str"] as const;

const EDITS = new Set(["edit", "multiedit", "multi_edit", "edit_file"]);
const WRITES = new Set(["write", "write_file", "create", "create_file"]);
const PATCHES = new Set(["apply_patch", "patch"]);

/** One find-and-replace of an edit tool, when the input has one. */
function replacement(value: unknown): FileChange | undefined {
	const before = stringField(value, BEFORE_KEYS);
	const after = stringField(value, AFTER_KEYS);
	if (before === undefined && after === undefined) return undefined;
	return { kind: "edit", before: before ?? "", after: after ?? "" };
}

/** Claude Code's answer to `Write` says whether it made the file. */
function writeCreates(result: string | undefined): boolean | undefined {
	if (result === undefined) return undefined;
	if (/\bcreated\b/i.test(result)) return true;
	if (/\b(updated|overwr)/i.test(result)) return false;
	return undefined;
}

/** The diffs an ACP agent sends back in its answer: `[{type: "diff", path, oldText, newText}]`. */
function acpDiffs(result: string | undefined): Touch[] {
	const blocks = jsonResult(result);
	if (!Array.isArray(blocks)) return [];
	return blocks.flatMap((block): Touch[] => {
		if (!isRecord(block) || block.type !== "diff") return [];
		const path = stringField(block, ["path"]);
		const after = stringField(block, ["newText"]);
		if (!path || after === undefined) return [];
		const before = stringField(block, ["oldText"]);
		return before === undefined
			? [{ path, change: { kind: "write", content: after }, creates: true }]
			: [{ path, change: { kind: "edit", before, after } }];
	});
}

function editTouches(call: AgentToolCall): Touch[] {
	const path = stringField(call.input, PATH_KEYS);
	const input = isRecord(call.input) ? call.input : {};
	if (path) {
		if (Array.isArray(input.edits)) {
			const changes = input.edits.flatMap((edit) => {
				const change = replacement(edit);
				return change ? [change] : [];
			});
			if (changes.length > 0)
				return changes.map((change) => ({ path, change }));
		}
		const change = replacement(input);
		if (change) return [{ path, change }];
		const content = stringField(input, ["content"]);
		if (content !== undefined) {
			return [{ path, change: { kind: "write", content } }];
		}
	}
	const diffs = acpDiffs(call.result);
	if (diffs.length > 0) return diffs;
	return path ? [{ path, change: { kind: "unknown" } }] : [];
}

/**
 * The files of an `apply_patch` patch (Codex's format, also OpenCode's):
 * `*** Add File: p`, `*** Update File: p` (with `*** Move to: q`) and
 * `*** Delete File: p`, each followed by its lines.
 */
function patchTouches(patch: string): Touch[] {
	const touches: Touch[] = [];
	let current:
		| { op: "add" | "update"; path: string; lines: string[] }
		| undefined;
	const close = () => {
		if (!current) return;
		touches.push(
			current.op === "add"
				? {
						path: current.path,
						change: {
							kind: "write",
							content: current.lines
								.map((line) => (line.startsWith("+") ? line.slice(1) : line))
								.join("\n"),
						},
						creates: true,
					}
				: {
						path: current.path,
						change: { kind: "patch", diff: current.lines.join("\n") },
					},
		);
		current = undefined;
	};
	for (const line of patch.split("\n")) {
		const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
		if (header?.[1] && header[2]) {
			close();
			const path = header[2].trim();
			if (header[1] === "Delete") {
				touches.push({ path, change: { kind: "delete" } });
			} else {
				current = {
					op: header[1] === "Add" ? "add" : "update",
					path,
					lines: [],
				};
			}
			continue;
		}
		const move = /^\*\*\* Move to: (.+)$/.exec(line);
		if (move?.[1] && current) {
			current.path = move[1].trim();
			continue;
		}
		if (/^\*\*\* (Begin|End) Patch/.test(line) || line === "*** End of File") {
			if (line.startsWith("*** End Patch")) close();
			continue;
		}
		current?.lines.push(line);
	}
	close();
	return touches;
}

/** Codex's `file_change`: `{changes: [{path, kind: add | delete | update}]}`, no content. */
function codexTouches(input: unknown): Touch[] {
	if (!isRecord(input) || !Array.isArray(input.changes)) return [];
	return input.changes.flatMap((change): Touch[] => {
		const path = stringField(change, ["path"]);
		if (!path) return [];
		const kind = isRecord(change) ? change.kind : undefined;
		if (kind === "delete") return [{ path, change: { kind: "delete" } }];
		return [
			{
				path,
				change: { kind: "unknown" },
				creates: kind === "add" || undefined,
			},
		];
	});
}

function touchesOf(call: AgentToolCall): Touch[] {
	if (call.failed) return [];
	const name = toolName(call.name);
	if (EDITS.has(name)) return editTouches(call);
	if (WRITES.has(name)) {
		const path = stringField(call.input, PATH_KEYS);
		const content = stringField(call.input, ["content", "contents", "text"]);
		if (!path || content === undefined) return [];
		return [
			{
				path,
				change: { kind: "write", content },
				creates: writeCreates(call.result),
			},
		];
	}
	if (name === "notebookedit") {
		const path = stringField(call.input, PATH_KEYS);
		if (!path) return [];
		const source = stringField(call.input, ["new_source"]);
		const mode = stringField(call.input, ["edit_mode"]);
		return [
			{
				path,
				change:
					mode === "delete" || source === undefined
						? { kind: "unknown" }
						: { kind: "edit", before: "", after: source },
			},
		];
	}
	if (PATCHES.has(name)) {
		const patch =
			typeof call.input === "string"
				? call.input
				: stringField(call.input, ["patchText", "patch", "input"]);
		return patch ? patchTouches(patch) : [];
	}
	if (name === "file_change") return codexTouches(call.input);
	if (name === "delete") {
		const path = stringField(call.input, PATH_KEYS);
		return path ? [{ path, change: { kind: "delete" } }] : [];
	}
	return [];
}

/**
 * The files a step's agent changed, by path, from its tool calls: Claude
 * Code's `Edit`, `MultiEdit`, `Write` and `NotebookEdit`, OpenCode's and
 * pi's `edit` and `write`, `apply_patch` patches, and Codex's
 * `file_change`. Failed calls changed nothing. `root` is the project's
 * folder, to show paths relative to it.
 */
export function changedFiles(
	calls: readonly AgentToolCall[],
	root?: string,
): ChangedFile[] {
	const files = new Map<
		string,
		{ changes: FileChange[]; created: boolean; deleted: boolean }
	>();
	for (const call of calls) {
		for (const touch of touchesOf(call)) {
			const path = projectPath(touch.path, root);
			if (!path) continue;
			const known = files.get(path);
			if (!known) {
				files.set(path, {
					changes: [touch.change],
					// A first write the harness says nothing more of made the file.
					created: touch.creates ?? touch.change.kind === "write",
					deleted: touch.change.kind === "delete",
				});
				continue;
			}
			known.changes.push(touch.change);
			known.deleted = touch.change.kind === "delete";
		}
	}
	return [...files]
		.map(([path, file]) => ({
			path,
			status: file.deleted
				? ("deleted" as const)
				: file.created
					? ("added" as const)
					: ("edited" as const),
			changes: file.changes,
		}))
		.sort((a, b) => a.path.localeCompare(b.path));
}

/** A folder or a file of a file tree. */
export type FileTreeNode<T> =
	| { kind: "folder"; name: string; path: string; children: FileTreeNode<T>[] }
	| { kind: "file"; name: string; path: string; file: T };

type Folder<T> = { folders: Map<string, Folder<T>>; files: Map<string, T> };

/**
 * Files laid out as a tree of folders, folders before files, each by name.
 * A folder whose only child is a folder joins it ("src/runs"), so a deep
 * path takes one row.
 */
export function fileTree<T extends { path: string }>(
	files: readonly T[],
): FileTreeNode<T>[] {
	const root: Folder<T> = { folders: new Map(), files: new Map() };
	for (const file of files) {
		const parts = file.path.split("/").filter((part) => part !== "");
		const name = parts.pop();
		if (!name) continue;
		let folder = root;
		for (const part of parts) {
			let next = folder.folders.get(part);
			if (!next) {
				next = { folders: new Map(), files: new Map() };
				folder.folders.set(part, next);
			}
			folder = next;
		}
		folder.files.set(name, file);
	}
	const nodes = (folder: Folder<T>, prefix: string): FileTreeNode<T>[] => {
		const byName = (a: { name: string }, b: { name: string }) =>
			a.name.localeCompare(b.name);
		const folders = [...folder.folders].map(([name, child]) => {
			let label = name;
			let inner = child;
			while (inner.files.size === 0 && inner.folders.size === 1) {
				const [nextName, next] = [...inner.folders][0] as [string, Folder<T>];
				label = `${label}/${nextName}`;
				inner = next;
			}
			const path = prefix ? `${prefix}/${label}` : label;
			return {
				kind: "folder" as const,
				name: label,
				path,
				children: nodes(inner, path),
			};
		});
		const leaves = [...folder.files].map(([name, file]) => ({
			kind: "file" as const,
			name,
			path: file.path,
			file,
		}));
		return [...folders.sort(byName), ...leaves.sort(byName)];
	};
	return nodes(root, "");
}
