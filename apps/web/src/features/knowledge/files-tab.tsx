import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { BookOpenIcon, TriangleAlertIcon } from "lucide-react";
import type { Knowledge } from "@/shared/api";
import { FolderBrowser } from "./folder-browser";
import { KnowledgeSearch } from "./knowledge-search";
import { AskedQuestions } from "./questions";
import type { EditedSource } from "./source-dialog";
import { Sources } from "./sources";

/**
 * What agents know: search and every file by folder, then where it comes
 * from, and what agents asked of it.
 */
export function FilesTab({
	projectId,
	knowledge,
	onOpenFile,
	onAdd,
	onEdit,
}: {
	projectId: string;
	knowledge: Knowledge;
	onOpenFile: (path: string) => void;
	/** Unset: the person may not add a source. */
	onAdd: (() => void) | undefined;
	onEdit: (source: EditedSource) => void;
}) {
	const { files, syncs, tooLarge, shared, can } = knowledge;
	const browser = (
		<>
			{tooLarge ? (
				<Alert>
					<TriangleAlertIcon />
					<AlertTitle>This knowledge is very large</AlertTitle>
					<AlertDescription>
						It has more than 2 000 files. Agents find less in this much text.
						Sync only what they need.
					</AlertDescription>
				</Alert>
			) : null}
			<FolderBrowser projectId={projectId} files={files} onOpen={onOpenFile} />
		</>
	);
	return (
		<div className="flex flex-col gap-6">
			{files.length > 0 ? (
				<KnowledgeSearch projectId={projectId} idle={browser} />
			) : (
				browser
			)}
			{syncs.length > 0 ? (
				<Sources
					projectId={projectId}
					syncs={syncs}
					shared={shared}
					can={can}
					onEdit={onEdit}
				/>
			) : (
				<Alert>
					<BookOpenIcon />
					<AlertTitle>Nothing adds files to this knowledge</AlertTitle>
					<AlertDescription>
						Add a source, such as a folder or web pages, to keep it up to date.
					</AlertDescription>
					{onAdd ? (
						<AlertAction>
							<Button size="sm" variant="outline" onClick={onAdd}>
								Add source
							</Button>
						</AlertAction>
					) : null}
				</Alert>
			)}
			{files.length > 0 ? (
				<AskedQuestions
					projectId={projectId}
					mayChange={can.startRuns}
					files={files.map((file) => file.path)}
				/>
			) : null}
		</div>
	);
}
