import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { FileTextIcon } from "lucide-react";
import type { KnowledgeFile } from "@/shared/api";
import { dataTableColumns } from "@/shared/data-table";
import { formatRelative, formatSize, hoverTime } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import type { FileUse } from "./file-use";
import { isUnused } from "./file-use";
import { fileNameOf, folderOf } from "./folder-tree";

const column = dataTableColumns<KnowledgeFile>();

/**
 * The columns of a list of files. A file's name opens it. A file in a folder
 * below `folder` says which one.
 */
export function fileColumns(
	open: (path: string) => void,
	use: FileUse,
	folder: string,
) {
	return column.columns([
		column.accessor("path", {
			header: "File",
			cell: ({ row }) => {
				const { path, local } = row.original;
				const inner = folderOf(path);
				return (
					<div className="flex items-start gap-2">
						<FileTextIcon
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0 text-muted-foreground"
						/>
						<div className="flex min-w-0 flex-col gap-0.5">
							<div className="flex flex-wrap items-center gap-2">
								<Button
									variant="link"
									className="h-auto whitespace-normal break-all p-0 text-left"
									title={path}
									onClick={() => open(path)}
								>
									{fileNameOf(path)}
								</Button>
								{local ? (
									<Tooltip>
										<TooltipTrigger render={<Badge variant="secondary" />}>
											On one computer
										</TooltipTrigger>
										<TooltipContent>
											Larger than 10 MB. It stays on the computer that synced
											it.
										</TooltipContent>
									</Tooltip>
								) : null}
							</div>
							{inner !== folder ? (
								<span className="break-all font-mono text-muted-foreground text-xs">
									{inner}
								</span>
							) : null}
						</div>
					</div>
				);
			},
			meta: {
				headClassName: "pl-4",
				cellClassName: "w-full max-w-0 py-2.5 pl-4",
			},
		}),
		column.display({
			id: "used",
			header: "Used by agents",
			cell: ({ row }) => {
				const used = use.byPath.get(row.original.path);
				return (
					<div className="flex flex-wrap items-center gap-2">
						{used ? (
							<span
								className="whitespace-nowrap text-muted-foreground text-sm tabular-nums"
								title={`Last used ${hoverTime(used.lastAt)}`}
							>
								Found {used.found}, read {used.read}
							</span>
						) : null}
						{isUnused(use, row.original) ? (
							<Tooltip>
								<TooltipTrigger render={<Badge variant="outline" />}>
									Not used
								</TooltipTrigger>
								<TooltipContent>
									No run used this file in {use.unusedDays} days. Stop syncing
									it if your agents do not need it.
								</TooltipContent>
							</Tooltip>
						) : null}
					</div>
				);
			},
			meta: { cellClassName: "py-2.5" },
		}),
		column.accessor("changedAt", {
			header: "Changed",
			cell: ({ row }) => (
				<LocalTime
					at={row.original.changedAt}
					className="whitespace-nowrap text-muted-foreground text-sm"
				>
					{formatRelative(row.original.changedAt)}
				</LocalTime>
			),
			meta: { cellClassName: "py-2.5" },
		}),
		column.accessor("size", {
			header: "Size",
			cell: ({ row }) => (
				<span className="whitespace-nowrap text-muted-foreground text-sm tabular-nums">
					{formatSize(row.original.size)}
				</span>
			),
			meta: { headClassName: "pr-4", cellClassName: "py-2.5 pr-4 text-right" },
		}),
	]);
}
