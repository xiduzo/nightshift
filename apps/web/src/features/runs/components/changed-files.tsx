import {
	type ChangedFile,
	type FileChange,
	type FileTreeNode,
	fileTree,
} from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	CodeBlock,
	CodeBlockActions,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockHeader,
	CodeBlockTitle,
} from "@nightshift/ui/components/code-block";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import {
	ChevronRightIcon,
	FileIcon,
	FileMinusIcon,
	FilePlusIcon,
	FolderIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import {
	CodeView,
	DiffLines,
	type DiffLineVariant,
	languageOfPath,
} from "@/shared/code";

const STATUS_LABEL: Record<ChangedFile["status"], string> = {
	added: "Added",
	edited: "Edited",
	deleted: "Deleted",
	renamed: "Renamed",
};

/**
 * The files the step changed, as the AI Elements File Tree: a folder opens
 * and closes, a file opens what changed in it in a Sheet. Its agent's edits
 * and what commands changed, from the run's copy of the project.
 */
export function ChangedFiles({
	files,
	title,
	marksCommands = false,
	overlapped = false,
	omitted = 0,
}: {
	files: ChangedFile[];
	/** The section's heading, with its count. */
	title: ReactNode;
	/** Marks the files a command changed: the step's agent edits files too. */
	marksCommands?: boolean;
	/** Other steps ran at the same time: the list can hold their changes. */
	overlapped?: boolean;
	/** How many more files changed than the list holds. */
	omitted?: number;
}) {
	const tree = useMemo(() => fileTree(files), [files]);
	const [openPath, setOpenPath] = useState<string | null>(null);
	const open = files.find((file) => file.path === openPath);
	const notes = [
		overlapped
			? "Other steps ran at the same time. This list can include their changes."
			: null,
		files.some((file) => file.cut)
			? "Some changes are too long to show in full."
			: null,
		omitted === 1
			? "1 more file changed. It does not show here."
			: omitted > 1
				? `${omitted} more files changed. They do not show here.`
				: null,
	].filter((note) => note !== null);

	return (
		<section
			aria-labelledby="step-files-heading"
			className="flex flex-col gap-2"
		>
			{title}
			<div className="flex flex-col rounded-lg border p-1">
				{tree.map((node) => (
					<TreeNode
						key={node.path}
						node={node}
						onSelect={setOpenPath}
						marksCommands={marksCommands}
					/>
				))}
			</div>
			{notes.map((note) => (
				<p key={note} className="text-muted-foreground text-xs">
					{note}
				</p>
			))}
			<Sheet
				open={open !== undefined}
				onOpenChange={(next) => {
					if (!next) setOpenPath(null);
				}}
			>
				<SheetContent className="data-[side=right]:sm:max-w-2xl">
					{open ? (
						<FileChanges file={open} marksCommands={marksCommands} />
					) : null}
				</SheetContent>
			</Sheet>
		</section>
	);
}

function TreeNode({
	node,
	onSelect,
	marksCommands,
}: {
	node: FileTreeNode<ChangedFile>;
	onSelect: (path: string) => void;
	marksCommands: boolean;
}) {
	if (node.kind === "folder") {
		return (
			<Collapsible defaultOpen>
				<CollapsibleTrigger
					render={
						<Button
							variant="ghost"
							size="sm"
							className="group/folder w-full justify-start font-normal"
						/>
					}
				>
					<ChevronRightIcon
						data-icon="inline-start"
						className="text-muted-foreground transition-transform group-data-panel-open/folder:rotate-90 motion-reduce:transition-none"
					/>
					<FolderIcon className="text-muted-foreground" />
					<span className="truncate font-mono text-xs">{node.name}</span>
				</CollapsibleTrigger>
				<CollapsibleContent className="ml-4 flex flex-col">
					{node.children.map((child) => (
						<TreeNode
							key={child.path}
							node={child}
							onSelect={onSelect}
							marksCommands={marksCommands}
						/>
					))}
				</CollapsibleContent>
			</Collapsible>
		);
	}
	const { status } = node.file;
	const byCommand = marksCommands && node.file.byCommand === true;
	const Icon =
		status === "added"
			? FilePlusIcon
			: status === "deleted"
				? FileMinusIcon
				: FileIcon;
	return (
		<Button
			variant="ghost"
			size="sm"
			className="w-full justify-start font-normal"
			title={node.path}
			onClick={() => onSelect(node.path)}
		>
			<Icon data-icon="inline-start" className="text-muted-foreground" />
			<span
				className={
					status === "deleted"
						? "truncate font-mono text-muted-foreground text-xs line-through"
						: "truncate font-mono text-xs"
				}
			>
				{node.name}
			</span>
			{byCommand ? (
				<Badge variant="outline" className="ml-auto text-muted-foreground">
					By command
				</Badge>
			) : null}
			<Badge
				variant={
					status === "edited" || status === "renamed" ? "outline" : "secondary"
				}
				className={byCommand ? undefined : "ml-auto"}
			>
				{STATUS_LABEL[status]}
			</Badge>
		</Button>
	);
}

/** "12 lines added, 3 removed": a file's lines over the step. */
function linesText({ added, removed }: { added: number; removed: number }) {
	return `${added} ${added === 1 ? "line" : "lines"} added, ${removed} removed`;
}

/** Why a file has no change to show: binary, or too long to keep. */
function noChangeText(file: ChangedFile): string {
	if (file.binary)
		return "This is a binary file. Its changes do not show here.";
	const said = "The changes to this file do not show here.";
	if (!file.lines) return said;
	const { added, removed } = file.lines;
	return `${said} They add ${added} ${added === 1 ? "line" : "lines"} and remove ${removed}.`;
}

/**
 * What changed in one file: its whole change over the step and the
 * agent's edits one by one, as two tabs when it has both.
 */
function FileChanges({
	file,
	marksCommands,
}: {
	file: ChangedFile;
	marksCommands: boolean;
}) {
	const name = file.path.split("/").at(-1) ?? file.path;
	// The whole diff stands in for edits the tools did not tell (or there were none).
	const wholeDiff =
		file.diff === undefined &&
		file.changes.length === 1 &&
		file.changes[0]?.kind === "patch";
	return (
		<>
			<SheetHeader>
				<SheetTitle className="truncate pr-8 font-mono">{name}</SheetTitle>
				<SheetDescription className="break-all font-mono text-xs">
					{STATUS_LABEL[file.status]} · {file.path}
					{file.lines && !file.binary ? ` · ${linesText(file.lines)}` : ""}
				</SheetDescription>
				{file.oldPath ? (
					<p className="break-all font-mono text-muted-foreground text-xs">
						Renamed from {file.oldPath}
					</p>
				) : null}
				{marksCommands && file.byCommand ? (
					<p className="text-muted-foreground text-xs">
						A command changed this file.
					</p>
				) : null}
			</SheetHeader>
			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
				{file.changes.length === 0 ? (
					<p className="text-muted-foreground text-sm">{noChangeText(file)}</p>
				) : file.diff !== undefined ? (
					<Tabs defaultValue="all" className="gap-3">
						<TabsList>
							<TabsTrigger value="all">All changes</TabsTrigger>
							<TabsTrigger value="edits">Each edit</TabsTrigger>
						</TabsList>
						<TabsContent value="all" className="flex flex-col gap-3">
							<EachChange
								changes={[{ kind: "patch", diff: file.diff }]}
								path={file.path}
								cut={file.cut === true}
							/>
						</TabsContent>
						<TabsContent value="edits" className="flex flex-col gap-3">
							<EachChange changes={file.changes} path={file.path} cut={false} />
						</TabsContent>
					</Tabs>
				) : (
					<EachChange
						changes={file.changes}
						path={file.path}
						cut={file.cut === true && wholeDiff}
					/>
				)}
			</div>
		</>
	);
}

/** Changes one after the other, numbered when there are several, with a note when the diff is cut short. */
function EachChange({
	changes,
	path,
	cut,
}: {
	changes: FileChange[];
	path: string;
	cut: boolean;
}) {
	const many = changes.length > 1;
	return (
		<>
			{changes.map((change, index) => (
				<ChangeView
					key={index}
					change={change}
					path={path}
					title={many ? `Change ${index + 1} of ${changes.length}` : undefined}
				/>
			))}
			{cut ? (
				<p className="text-muted-foreground text-sm">
					The change is longer than this. The rest does not show here.
				</p>
			) : null}
		</>
	);
}

function ChangeView({
	change,
	path,
	title,
}: {
	change: FileChange;
	path: string;
	title?: string;
}) {
	switch (change.kind) {
		case "write":
			return (
				<CodeView
					code={change.content}
					language={languageOfPath(path)}
					title={title ?? "New content"}
					contentClassName="max-h-none"
				/>
			);
		case "edit": {
			const lines = [
				...(change.before === ""
					? []
					: change.before
							.split("\n")
							.map((text) => ({ variant: "removed" as const, text }))),
				...change.after
					.split("\n")
					.map((text) => ({ variant: "added" as const, text })),
			];
			return (
				<DiffBlock
					title={title}
					lines={lines}
					copy={change.after}
					language={languageOfPath(path)}
				/>
			);
		}
		case "patch": {
			const lines = change.diff.split("\n").map((line) => {
				const variant = line.startsWith("+")
					? ("added" as const)
					: line.startsWith("-")
						? ("removed" as const)
						: ("default" as const);
				return {
					variant,
					text: variant === "default" ? line : line.slice(1),
				};
			});
			return (
				<DiffBlock
					title={title}
					lines={lines}
					copy={change.diff}
					language={languageOfPath(path)}
				/>
			);
		}
		case "delete":
			return (
				<p className="text-muted-foreground text-sm">
					The agent deleted this file.
				</p>
			);
		case "unknown":
			return (
				<p className="text-muted-foreground text-sm">
					The agent changed this file but does not say how. The transcript shows
					what it did.
				</p>
			);
	}
}

/** Removed and added lines, marked, and highlighted in the file's language. */
function DiffBlock({
	title,
	lines,
	copy,
	language,
}: {
	title?: string;
	lines: { variant: DiffLineVariant; text: string }[];
	copy: string;
	language: string;
}) {
	const actions = (
		<CodeBlockActions>
			<CodeBlockCopyButton value={copy} />
		</CodeBlockActions>
	);
	return (
		<CodeBlock size="sm">
			{title ? (
				<CodeBlockHeader>
					<CodeBlockTitle>{title}</CodeBlockTitle>
					{actions}
				</CodeBlockHeader>
			) : (
				actions
			)}
			<CodeBlockContent wrap>
				<DiffLines lines={lines} language={language} />
			</CodeBlockContent>
		</CodeBlock>
	);
}
