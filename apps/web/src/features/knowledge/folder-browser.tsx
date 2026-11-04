import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@nightshift/ui/components/breadcrumb";
import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ChevronRightIcon,
	FolderIcon,
	FolderOpenIcon,
	LibraryIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { KnowledgeFile } from "@/shared/api";
import { DataTable } from "@/shared/data-table";
import { fileColumns } from "./file-columns";
import { fileUse } from "./file-use";
import {
	type FolderNode,
	folderTrail,
	folderTree,
	isInFolder,
} from "./folder-tree";
import { knowledgeQueries } from "./queries";

/**
 * Every file of the knowledge: the folders on the left, the files of the
 * chosen folder on the right, with how agents used them. Each side scrolls on
 * its own.
 */
export function FolderBrowser({
	projectId,
	files,
	onOpen,
}: {
	projectId: string;
	files: KnowledgeFile[];
	onOpen: (path: string) => void;
}) {
	const tree = useMemo(() => folderTree(files.map((f) => f.path)), [files]);
	const [chosen, setChosen] = useState("");
	const use = useQuery(knowledgeQueries.use(projectId));
	// A sync can take the chosen folder away.
	const folder = files.some((file) => isInFolder(file.path, chosen))
		? chosen
		: "";
	const shown = useMemo(
		() => files.filter((file) => isInFolder(file.path, folder)),
		[files, folder],
	);
	const columns = useMemo(
		() => fileColumns(onOpen, fileUse(use.data), folder),
		[onOpen, use.data, folder],
	);
	if (files.length === 0) {
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyTitle>No files yet</EmptyTitle>
					<EmptyDescription>
						Add a source, or choose Sync now on a source you have.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button
						variant="outline"
						nativeButton={false}
						render={
							<Link
								to="/projects/$projectId/knowledge/sources"
								params={{ projectId }}
							/>
						}
					>
						Open sources
					</Button>
				</EmptyContent>
			</Empty>
		);
	}
	return (
		<Card className="gap-0 overflow-hidden py-0">
			<div className="grid md:h-[34rem] md:grid-cols-[16rem_minmax(0,1fr)]">
				<nav
					aria-label="Folders"
					className="flex max-h-56 flex-col gap-0.5 overflow-y-auto border-b p-2 md:max-h-none md:border-r md:border-b-0"
				>
					<Button
						variant={folder === "" ? "secondary" : "ghost"}
						size="sm"
						className="w-full justify-start"
						aria-current={folder === "" ? "true" : undefined}
						onClick={() => setChosen("")}
					>
						<LibraryIcon data-icon="inline-start" />
						All files
						<FolderCount count={tree.count} />
					</Button>
					{tree.children.map((child) => (
						<FolderBranch
							key={child.path}
							node={child}
							depth={0}
							chosen={folder}
							onChoose={setChosen}
						/>
					))}
				</nav>
				<div className="flex min-h-0 min-w-0 flex-col">
					<div className="flex min-h-11 items-center justify-between gap-3 border-b px-4 py-2">
						<Breadcrumb>
							<BreadcrumbList>
								<BreadcrumbItem>
									{folder === "" ? (
										<BreadcrumbPage>All files</BreadcrumbPage>
									) : (
										<BreadcrumbLink
											render={
												<button type="button" onClick={() => setChosen("")} />
											}
										>
											All files
										</BreadcrumbLink>
									)}
								</BreadcrumbItem>
								{folderTrail(folder).flatMap((part) => [
									<BreadcrumbSeparator key={`${part.path}/`} />,
									<BreadcrumbItem key={part.path}>
										{part.path === folder ? (
											<BreadcrumbPage>{part.name}</BreadcrumbPage>
										) : (
											<BreadcrumbLink
												render={
													<button
														type="button"
														onClick={() => setChosen(part.path)}
													/>
												}
											>
												{part.name}
											</BreadcrumbLink>
										)}
									</BreadcrumbItem>,
								])}
							</BreadcrumbList>
						</Breadcrumb>
						<span className="whitespace-nowrap text-muted-foreground text-sm tabular-nums">
							{shown.length} {shown.length === 1 ? "file" : "files"}
						</span>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto">
						<DataTable
							columns={columns}
							data={shown}
							getRowId={(file) => file.path}
							pageSize={50}
						/>
					</div>
				</div>
			</div>
		</Card>
	);
}

function FolderCount({ count }: { count: number }) {
	return (
		<span className="ml-auto text-muted-foreground text-xs tabular-nums">
			{count}
		</span>
	);
}

/** One folder, and the folders in it when it is open. The top ones start open. */
function FolderBranch({
	node,
	depth,
	chosen,
	onChoose,
}: {
	node: FolderNode;
	depth: number;
	chosen: string;
	onChoose: (path: string) => void;
}) {
	const [open, setOpen] = useState(depth === 0);
	const isChosen = chosen === node.path;
	const row = (
		<div
			className="flex items-center gap-0.5"
			style={{ paddingLeft: `${depth * 0.75}rem` }}
		>
			{node.children.length > 0 ? (
				<CollapsibleTrigger
					render={
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={`${open ? "Close" : "Open"} ${node.name}`}
						/>
					}
				>
					<ChevronRightIcon className={open ? "rotate-90" : undefined} />
				</CollapsibleTrigger>
			) : (
				<span aria-hidden="true" className="size-6 shrink-0" />
			)}
			<Button
				variant={isChosen ? "secondary" : "ghost"}
				size="sm"
				className="min-w-0 flex-1 justify-start"
				aria-current={isChosen ? "true" : undefined}
				onClick={() => {
					onChoose(node.path);
					setOpen(true);
				}}
			>
				{isChosen ? (
					<FolderOpenIcon data-icon="inline-start" />
				) : (
					<FolderIcon data-icon="inline-start" />
				)}
				<span className="truncate">{node.name}</span>
				<FolderCount count={node.count} />
			</Button>
		</div>
	);
	if (node.children.length === 0) {
		return <Collapsible>{row}</Collapsible>;
	}
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			{row}
			<CollapsibleContent className="flex flex-col gap-0.5 pt-0.5">
				{node.children.map((child) => (
					<FolderBranch
						key={child.path}
						node={child}
						depth={depth + 1}
						chosen={chosen}
						onChoose={onChoose}
					/>
				))}
			</CollapsibleContent>
		</Collapsible>
	);
}
