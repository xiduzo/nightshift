import { projectPath } from "./project-path";
import {
	type AgentToolCall,
	isRecord,
	jsonResult,
	stringField,
	toolName,
} from "./tool-input";
import type { WorktreeChangesEvent } from "./types";

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
	/** Where the file was before the step renamed it. */
	oldPath?: string;
	status: "added" | "edited" | "deleted" | "renamed";
	/**
	 * The agent's edits, in call order. A file that only a command changed
	 * has its whole diff here, as one `patch`, when the diff is known.
	 */
	changes: FileChange[];
	/**
	 * The file's whole diff over the step, from the run's copy of the
	 * project, when the agent's edits are in `changes`.
	 */
	diff?: string;
	/** Lines added and removed over the step, from the run's copy of the project. */
	lines?: { added: number; removed: number };
	binary?: true;
	/** The diff is cut short, or too long to keep. */
	cut?: true;
	/** Changed outside the agent's edit tools: by a command, a formatter, a script. */
	byCommand?: true;
};

/**
 * What the run's copy of the project says the step changed (its last
 * `worktree-changes`): every file, also those a command changed.
 */
export type WorktreeFiles = Pick<WorktreeChangesEvent, "files">;

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

/** A change made the file: the harness says so, or a write it says nothing more of. */
function creates(touch: Touch): boolean {
	return touch.creates ?? touch.change.kind === "write";
}

/**
 * The call added every file it wrote, by the rule that marks a file
 * "added" in `changedFiles`: Claude Code's `Write` that answers "created",
 * an `apply_patch` that adds files, a write the harness says nothing more
 * of. False for a failed call and for a call that changed nothing.
 */
export function addsFiles(call: AgentToolCall): boolean {
	const touches = touchesOf(call);
	return touches.length > 0 && touches.every(creates);
}

/** A file as the agent's tool calls changed it. */
type ToolFile = { changes: FileChange[]; created: boolean; deleted: boolean };

/** The files of the tool calls, by path relative to `root`. */
function toolFiles(
	calls: readonly AgentToolCall[],
	root: string | undefined,
): Map<string, ToolFile> {
	const files = new Map<string, ToolFile>();
	for (const call of calls) {
		for (const touch of touchesOf(call)) {
			const path = projectPath(touch.path, root);
			if (!path) continue;
			const known = files.get(path);
			if (!known) {
				files.set(path, {
					changes: [touch.change],
					created: creates(touch),
					deleted: touch.change.kind === "delete",
				});
				continue;
			}
			known.changes.push(touch.change);
			known.deleted = touch.change.kind === "delete";
		}
	}
	return files;
}

/** A file's status in the run's copy of the project, in the words of the tool calls. */
function statusOf(
	status: WorktreeFiles["files"][number]["status"],
): ChangedFile["status"] {
	return status === "modified" ? "edited" : status;
}

/**
 * Whether a tool's path names `path` of the project: the same, or an
 * absolute path that ends with it (a step that ran in another computer's
 * copy of the project, which `root` does not name).
 */
function names(toolPath: string, path: string): boolean {
	return (
		toolPath === path ||
		(toolPath.startsWith("/") && toolPath.endsWith(`/${path}`))
	);
}

/**
 * The files a step changed, by path. From the agent's tool calls: Claude
 * Code's `Edit`, `MultiEdit`, `Write` and `NotebookEdit`, OpenCode's and
 * pi's `edit` and `write`, `apply_patch` patches, and Codex's
 * `file_change`. Failed calls changed nothing. `root` is the project's
 * folder, to show paths relative to it.
 *
 * With `worktree` (what the run's copy of the project says the step
 * changed), every file it lists is there too, also those a command, a
 * formatter or an install changed, and those of a Command step. A file
 * keeps the agent's edits; the copy of the project decides whether it was
 * added, deleted or renamed, and gives its whole diff. A file no edit tool
 * changed is `byCommand`, with that diff as its one change. A file the
 * tools changed that the copy does not list (outside the project, or
 * changed back) stays as the tools say.
 */
export function changedFiles(
	calls: readonly AgentToolCall[],
	root?: string,
	worktree?: WorktreeFiles,
): ChangedFile[] {
	const tools = toolFiles(calls, root);
	const files: ChangedFile[] = [];
	for (const file of worktree?.files ?? []) {
		const own = [...tools].filter(
			([path]) =>
				names(path, file.path) ||
				(file.oldPath !== undefined && names(path, file.oldPath)),
		);
		for (const [path] of own) tools.delete(path);
		const edits = own.flatMap(([, tool]) => tool.changes);
		const whole: FileChange[] =
			file.patch === undefined ? [] : [{ kind: "patch", diff: file.patch }];
		// An edit the harness gives no detail of says less than the diff.
		const told = edits.some((change) => change.kind !== "unknown");
		files.push({
			path: file.path,
			...(file.oldPath !== undefined ? { oldPath: file.oldPath } : {}),
			status: statusOf(file.status),
			changes: told ? edits : whole,
			...(told && file.patch !== undefined ? { diff: file.patch } : {}),
			lines: { added: file.added, removed: file.removed },
			...(file.binary ? { binary: true as const } : {}),
			...(file.truncated ? { cut: true as const } : {}),
			...(own.length === 0 ? { byCommand: true as const } : {}),
		});
	}
	for (const [path, file] of tools) {
		files.push({
			path,
			status: file.deleted ? "deleted" : file.created ? "added" : "edited",
			changes: file.changes,
		});
	}
	return files.sort((a, b) => a.path.localeCompare(b.path));
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
