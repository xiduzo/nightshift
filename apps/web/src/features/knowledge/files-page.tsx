import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { TriangleAlertIcon } from "lucide-react";
import { FolderBrowser } from "./folder-browser";
import {
	AddSourceButton,
	KnowledgeSection,
	useKnowledge,
} from "./knowledge-layout";
import { KnowledgeSearch } from "./knowledge-search";

/** Every file agents can read: the search on top, then the files by folder. */
export function KnowledgeFilesPage() {
	const { projectId, knowledge, openFile } = useKnowledge();
	const { files, tooLarge } = knowledge;
	const browser = (
		<>
			{tooLarge ? (
				<Alert>
					<TriangleAlertIcon />
					<AlertTitle>You have more than 2 000 files</AlertTitle>
					<AlertDescription>
						Agents find less in this much text. Sync only what they need.
					</AlertDescription>
				</Alert>
			) : null}
			<FolderBrowser projectId={projectId} files={files} onOpen={openFile} />
		</>
	);
	return (
		<KnowledgeSection
			title="Files"
			description="Everything your agents can read. Every computer in this Space gets the same files."
			actions={<AddSourceButton />}
		>
			{files.length > 0 ? (
				<KnowledgeSearch projectId={projectId} idle={browser} />
			) : (
				browser
			)}
		</KnowledgeSection>
	);
}
