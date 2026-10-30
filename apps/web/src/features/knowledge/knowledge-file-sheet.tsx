import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon } from "lucide-react";
import { CodeView, languageOfPath } from "@/shared/code";
import { formatSize } from "@/shared/format";
import { knowledgeQueries } from "./queries";

/**
 * One file of the knowledge, in a sheet beside the list. This computer's
 * copy, else its content from the Space when this computer lacks it.
 */
export function KnowledgeFileSheet({
	projectId,
	path,
	onClose,
}: {
	projectId: string;
	path: string | null;
	onClose: () => void;
}) {
	const file = useQuery({
		...knowledgeQueries.read(projectId, path ?? ""),
		enabled: path !== null,
	});
	return (
		<Sheet open={path !== null} onOpenChange={(next) => !next && onClose()}>
			<SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
				<SheetHeader>
					<SheetTitle>{file.data?.title ?? path}</SheetTitle>
					<SheetDescription className="break-all font-mono text-xs">
						{path}
						{file.data ? ` · ${formatSize(file.data.size)}` : ""}
					</SheetDescription>
				</SheetHeader>
				{file.error ? (
					<Alert variant="destructive" className="mx-4 w-auto">
						<CircleAlertIcon />
						<AlertTitle>The file did not open</AlertTitle>
						<AlertDescription>{file.error.message}</AlertDescription>
					</Alert>
				) : file.isLoading ? (
					<Skeleton className="mx-4 h-40" />
				) : !file.data ? (
					<Alert className="mx-4 w-auto">
						<CircleAlertIcon />
						<AlertTitle>This file is gone</AlertTitle>
						<AlertDescription>
							A sync changed the knowledge. Look for the file again.
						</AlertDescription>
					</Alert>
				) : (
					<>
						{file.data.truncated ? (
							<p className="mx-4 text-muted-foreground text-sm">
								This file is large. You see its start.
							</p>
						) : null}
						<CodeView
							code={file.data.text}
							language={languageOfPath(file.data.path)}
							className="mx-4 mb-4 min-h-0 w-auto flex-1"
							contentClassName="max-h-none"
						/>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}
