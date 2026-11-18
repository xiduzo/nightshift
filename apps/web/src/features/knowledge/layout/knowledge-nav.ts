import {
	FileTextIcon,
	FolderSyncIcon,
	ListChecksIcon,
	type LucideIcon,
	MessageCircleQuestionIcon,
	NetworkIcon,
} from "lucide-react";

/** The child pages of a project's Knowledge, in the order of the overview. */
export const KNOWLEDGE_PAGES: readonly {
	to:
		| "/projects/$projectId/knowledge/review"
		| "/projects/$projectId/knowledge/files"
		| "/projects/$projectId/knowledge/sources"
		| "/projects/$projectId/knowledge/questions"
		| "/projects/$projectId/knowledge/map";
	label: string;
	icon: LucideIcon;
}[] = [
	{
		to: "/projects/$projectId/knowledge/review",
		label: "Review",
		icon: ListChecksIcon,
	},
	{
		to: "/projects/$projectId/knowledge/files",
		label: "Files",
		icon: FileTextIcon,
	},
	{
		to: "/projects/$projectId/knowledge/sources",
		label: "Sources",
		icon: FolderSyncIcon,
	},
	{
		to: "/projects/$projectId/knowledge/questions",
		label: "Questions",
		icon: MessageCircleQuestionIcon,
	},
	{
		to: "/projects/$projectId/knowledge/map",
		label: "Map",
		icon: NetworkIcon,
	},
];
