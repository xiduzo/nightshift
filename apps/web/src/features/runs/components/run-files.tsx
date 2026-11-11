import { Button } from "@nightshift/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { DownloadIcon, FileIcon } from "lucide-react";
import { walkerName } from "@/features/devices";
import { type RunDetail, type RunFiles, SERVER_URL } from "@/shared/api";
import { formatDateTime, formatSize } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { runFilePath } from "../lib/run-files";

/**
 * The files a run of a project without a folder wrote, by path. Each opens
 * in a new tab or downloads. Under them: when Night Shift removes them.
 * When they are not here: when they were removed, or which computer has
 * them.
 */
export function RunFilesList({
	run,
	files,
}: {
	run: RunDetail;
	files: RunFiles;
}) {
	if (!files.here) {
		return (
			<p className="text-muted-foreground text-xs">
				{files.removed ? (
					<>
						Removed on{" "}
						<LocalTime at={files.removed.at}>
							{formatDateTime(files.removed.at)}
						</LocalTime>
						.
					</>
				) : run.device.thisDevice ? (
					"On another computer. Open this run on the computer that ran its steps."
				) : (
					`On another computer. Open this run on ${walkerName(run.device)} to see them.`
				)}
			</p>
		);
	}

	const url = (path: string, download?: boolean) =>
		`${SERVER_URL}${runFilePath(run.id, path, download)}`;
	return (
		<div className="flex flex-col gap-2">
			<Table className="text-xs">
				<TableHeader>
					<TableRow>
						<TableHead>File</TableHead>
						<TableHead className="text-right">Size</TableHead>
						<TableHead>
							<span className="sr-only">Download</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{files.files.map((file) => (
						<TableRow key={file.path}>
							<TableCell className="w-full max-w-0">
								<Button
									variant="link"
									size="xs"
									className="h-auto max-w-full justify-start px-0"
									title={`Open ${file.path}`}
									nativeButton={false}
									render={
										<a href={url(file.path)} target="_blank" rel="noreferrer" />
									}
								>
									<FileIcon data-icon="inline-start" aria-hidden="true" />
									<span className="truncate">{file.path}</span>
								</Button>
							</TableCell>
							<TableCell className="whitespace-nowrap text-right text-muted-foreground tabular-nums">
								{formatSize(file.size)}
							</TableCell>
							<TableCell className="w-0 p-0">
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label={`Download ${file.path}`}
									title="Download"
									nativeButton={false}
									render={<a href={url(file.path, true)} download />}
								>
									<DownloadIcon />
								</Button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			{files.more ? (
				<p className="text-muted-foreground text-xs">
					This run has more files than the list shows.
				</p>
			) : null}
			{files.cleanupAt !== null ? (
				<p className="text-muted-foreground text-xs">
					Removed after{" "}
					<LocalTime at={files.cleanupAt}>
						{formatDateTime(files.cleanupAt)}
					</LocalTime>
					.
				</p>
			) : null}
		</div>
	);
}
