import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { FieldError, FieldGroup } from "@nightshift/ui/components/field";
import { InputGroupButton } from "@nightshift/ui/components/input-group";
import { ChevronDownIcon, ShieldIcon, TriangleAlertIcon } from "lucide-react";
import { PERMISSION_MODES } from "@/features/agents";
import {
	type AgentChoice,
	PromptInput,
	StartFromField,
	Suggestions,
} from "@/features/flows";
import type { PermissionMode } from "@/shared/api";

/** Prompts to start from, across domains. A click fills the box, it does not start. */
const STARTERS = [
	"Summarize what changed in this project this week.",
	"Find broken links in the docs and list them.",
	"Draft release notes from the recent changes.",
	"List the open questions in the notes, with where each one is.",
] as const;

/** The permission mode of a run without a profile, when the person picks none. */
export const DEFAULT_PERMISSION: PermissionMode = "acceptEdits";

/** The Permissions radio's value for "the profile's own mode". */
const FROM_PROFILE = ":profile";

/** The trigger's short word for a permission mode: its label up to the note. */
function shortPermission(mode: PermissionMode): string {
	const label = PERMISSION_MODES.find((m) => m.value === mode)?.label ?? mode;
	return label.replace(/\s*\(.*\)$/, "");
}

/**
 * The prompt half of a quick run: starters above the shared Prompt Input,
 * the same agent menus as the chat (profile, model per harness, effort)
 * and a Permissions menu in its bottom row, and where the run starts from
 * beside it.
 */
export function QuickRunPrompt({
	projectId,
	prompt,
	onPromptChange,
	agent,
	onAgentChange,
	permissionMode,
	onPermissionModeChange,
	baseRef,
	onBaseRefChange,
	withFolder,
	starting,
	error,
	onSubmit,
}: {
	projectId: string;
	prompt: string;
	onPromptChange: (prompt: string) => void;
	agent: AgentChoice;
	onAgentChange: (agent: AgentChoice) => void;
	/** Null: the profile's mode, else `DEFAULT_PERMISSION`. */
	permissionMode: PermissionMode | null;
	onPermissionModeChange: (mode: PermissionMode | null) => void;
	baseRef: string;
	onBaseRefChange: (ref: string) => void;
	/** A project without a folder has nothing to start from. */
	withFolder: boolean;
	starting: boolean;
	error: string | null;
	onSubmit: () => void;
}) {
	const usesProfile = agent.profile !== undefined;
	const fromProfile = usesProfile && permissionMode === null;
	const shownMode = permissionMode ?? DEFAULT_PERMISSION;
	const bypass = permissionMode === "bypassPermissions";
	// Nothing to set beside the box: the box takes the whole width.
	const aside = withFolder || bypass;

	return (
		<div
			className={
				aside
					? "grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
					: "grid gap-6"
			}
		>
			<div className="flex min-w-0 flex-col gap-3">
				<Suggestions
					items={STARTERS}
					wrap
					disabled={starting}
					onPick={(item) => onPromptChange(item)}
				/>
				<PromptInput
					label="Prompt"
					value={prompt}
					onValueChange={onPromptChange}
					onSubmit={onSubmit}
					placeholder="What should the agent do?"
					hint="Enter starts the run. Shift + Enter starts a new line."
					blockedBy={starting ? "Starting the run…" : null}
					submitLabel={starting ? "Starting…" : "Start run"}
					textareaClassName="min-h-40 max-h-[50dvh] md:min-h-64"
					autoFocus
					agent={{
						purpose: "run",
						choice: agent,
						onChoiceChange: onAgentChange,
					}}
					tools={
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<InputGroupButton
										className={
											bypass
												? "shrink-0 font-normal text-status-interrupted"
												: "shrink-0 font-normal text-muted-foreground"
										}
										aria-label={`Permissions: ${fromProfile ? "from the profile" : shortPermission(shownMode)}. Choose what the agent may do.`}
									>
										{bypass ? <TriangleAlertIcon /> : <ShieldIcon />}
										{fromProfile
											? "Profile permissions"
											: shortPermission(shownMode)}
										<ChevronDownIcon />
									</InputGroupButton>
								}
							/>
							<DropdownMenuContent align="start" className="w-80">
								<DropdownMenuGroup>
									<DropdownMenuLabel>Permissions</DropdownMenuLabel>
									<DropdownMenuRadioGroup
										value={fromProfile ? FROM_PROFILE : shownMode}
										onValueChange={(value: string) =>
											onPermissionModeChange(
												value === FROM_PROFILE
													? null
													: (value as PermissionMode),
											)
										}
									>
										{usesProfile ? (
											<DropdownMenuRadioItem value={FROM_PROFILE} closeOnClick>
												From the profile
											</DropdownMenuRadioItem>
										) : null}
										{PERMISSION_MODES.map(({ value, label }) => (
											<DropdownMenuRadioItem
												key={value}
												value={value}
												closeOnClick
											>
												{label}
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					}
				/>
				{error ? <FieldError>{error}</FieldError> : null}
			</div>

			{aside ? (
				<FieldGroup className="content-start gap-5 border-t pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-6">
					{withFolder ? (
						<StartFromField
							projectId={projectId}
							value={baseRef}
							onChange={onBaseRefChange}
						/>
					) : null}
					{bypass ? (
						<Alert className="border-status-interrupted/40 text-status-interrupted">
							<TriangleAlertIcon aria-hidden="true" />
							<AlertDescription className="text-status-interrupted">
								The agent runs every tool, shell commands included, without
								asking. Use it only on a project you trust.
							</AlertDescription>
						</Alert>
					) : null}
				</FieldGroup>
			) : null}
		</div>
	);
}
