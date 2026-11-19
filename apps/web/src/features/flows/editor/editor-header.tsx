// The header of the editor: where the flow is, Save, the More menu, the chat, the test marks and Run.

import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	CopyIcon,
	DownloadIcon,
	HistoryIcon,
	MoreHorizontalIcon,
	PlayIcon,
	Redo2Icon,
	Undo2Icon,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { AgentButton } from "@/shared/agent-button";
import { SiteHeader } from "@/shared/page";
import type { useChatPanel } from "../chat";
import type { TestMarksApi } from "../test-run";
import { TestBadge } from "../test-run";
import type { useRevisionView } from "./revisions";
import type { useFlowSave } from "./saving";
import { SaveButton } from "./saving";
import type { EditingSession } from "./session";

/** The editor's header: the breadcrumb, Save, the More menu, the chat button, the test marks and Run. */
export function EditorHeader({
	projectName,
	projectId,
	name,
	saveFlow,
	dirty,
	savable,
	save,
	canUndo,
	canRedo,
	preview,
	session,
	setShownRevision,
	setRevisionsOpen,
	everSaved,
	exportFlow,
	setCopying,
	chat,
	testMarks,
	selectNode,
	setStarting,
	runBlockedBy,
}: {
	projectName: string | undefined;
	projectId: string;
	name: string;
	saveFlow: ReturnType<typeof useFlowSave>["saveFlow"];
	dirty: boolean;
	savable: boolean;
	save: () => void;
	canUndo: boolean;
	canRedo: boolean;
	preview: ReturnType<typeof useChatPanel>["preview"];
	session: EditingSession;
	setShownRevision: ReturnType<typeof useRevisionView>["setShownRevision"];
	setRevisionsOpen: Dispatch<SetStateAction<boolean>>;
	everSaved: boolean;
	exportFlow: () => Promise<void>;
	setCopying: Dispatch<SetStateAction<boolean>>;
	chat: ReturnType<typeof useChatPanel>;
	testMarks: TestMarksApi;
	selectNode: (nodeId: string) => void;
	setStarting: Dispatch<SetStateAction<boolean>>;
	runBlockedBy: string | null;
}) {
	return (
		<SiteHeader
			crumbs={[
				{ label: "Home", link: { to: "/" } },
				{
					label: projectName ?? "Project",
					link: { to: "/projects/$projectId", params: { projectId } },
				},
				{
					label: "Flows",
					link: { to: "/projects/$projectId/flows", params: { projectId } },
				},
				{ label: <span className="font-mono">{name}</span> },
			]}
		>
			<SaveButton
				state={
					saveFlow.isPending
						? "saving"
						: !dirty
							? "saved"
							: !savable
								? "blocked"
								: saveFlow.isError
									? "failed"
									: "unsaved"
				}
				onClick={save}
			/>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="outline"
							size="icon-sm"
							aria-label={`More actions for ${name}`}
						/>
					}
				>
					<MoreHorizontalIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-56">
					<DropdownMenuGroup>
						<DropdownMenuItem
							disabled={!canUndo || preview !== null}
							onClick={() => session.undo()}
						>
							<Undo2Icon aria-hidden="true" />
							Undo
							<DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={!canRedo || preview !== null}
							onClick={() => session.redo()}
						>
							<Redo2Icon aria-hidden="true" />
							Redo
							<DropdownMenuShortcut>⇧⌘Z</DropdownMenuShortcut>
						</DropdownMenuItem>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => {
							setShownRevision(null);
							setRevisionsOpen(true);
						}}
					>
						<HistoryIcon aria-hidden="true" />
						Revisions
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						disabled={!everSaved}
						onClick={() => void exportFlow()}
					>
						<DownloadIcon aria-hidden="true" />
						Export as file
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!everSaved}
						onClick={() => setCopying(true)}
					>
						<CopyIcon aria-hidden="true" />
						Copy into project…
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<AgentButton
				entry="flow.build"
				variant={chat.open ? "secondary" : "outline"}
				aria-pressed={chat.open}
				onClick={chat.toggle}
			/>
			<TestBadge test={testMarks} onSelectNode={selectNode} />
			<Button
				size="sm"
				onClick={() => setStarting(true)}
				disabled={runBlockedBy !== null}
				title={runBlockedBy ?? "Run this flow"}
			>
				<PlayIcon data-icon="inline-start" />
				Run
			</Button>
		</SiteHeader>
	);
}
