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
};

/**
 * The files the step's agent changed, as the AI Elements File Tree: a
 * folder opens and closes, a file opens what changed in it in a Sheet.
 */
export function ChangedFiles({
	files,
	title,
}: {
	files: ChangedFile[];
	/** The section's heading, with its count. */
	title: ReactNode;
}) {
	const tree = useMemo(() => fileTree(files), [files]);
	const [openPath, setOpenPath] = useState<string | null>(null);
	const open = files.find((file) => file.path === openPath);

	return (
		<section
			aria-labelledby="step-files-heading"
			className="flex flex-col gap-2"
		>
			{title}
			<div className="flex flex-col rounded-lg border p-1">
				{tree.map((node) => (
					<TreeNode key={node.path} node={node} onSelect={setOpenPath} />
				))}
			</div>
			<Sheet
				open={open !== undefined}
				onOpenChange={(next) => {
					if (!next) setOpenPath(null);
				}}
			>
				<SheetContent className="data-[side=right]:sm:max-w-2xl">
					{open ? <FileChanges file={open} /> : null}
				</SheetContent>
			</Sheet>
		</section>
	);
}

function TreeNode({
	node,
	onSelect,
}: {
	node: FileTreeNode<ChangedFile>;
	onSelect: (path: string) => void;
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
						<TreeNode key={child.path} node={child} onSelect={onSelect} />
					))}
				</CollapsibleContent>
			</Collapsible>
		);
	}
	const { status } = node.file;
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
			<Badge
				variant={status === "edited" ? "outline" : "secondary"}
				className="ml-auto"
			>
				{STATUS_LABEL[status]}
			</Badge>
		</Button>
	);
}

/** What changed in one file, change by change. */
function FileChanges({ file }: { file: ChangedFile }) {
	const name = file.path.split("/").at(-1) ?? file.path;
	const many = file.changes.length > 1;
	return (
		<>
			<SheetHeader>
				<SheetTitle className="truncate pr-8 font-mono">{name}</SheetTitle>
				<SheetDescription className="break-all font-mono text-xs">
					{STATUS_LABEL[file.status]} · {file.path}
				</SheetDescription>
			</SheetHeader>
			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
				{file.changes.map((change, index) => (
					<ChangeView
						key={index}
						change={change}
						path={file.path}
						title={
							many ? `Change ${index + 1} of ${file.changes.length}` : undefined
						}
					/>
				))}
			</div>
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
