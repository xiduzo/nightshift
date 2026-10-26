import type { Suggestion, SuggestionKind, TextRange } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@nightshift/ui/components/input-group";
import { Kbd } from "@nightshift/ui/components/kbd";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@nightshift/ui/components/popover";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { ArrowUpIcon, CircleAlertIcon } from "lucide-react";
import {
	type ReactElement,
	type ReactNode,
	type RefObject,
	useId,
	useRef,
	useState,
} from "react";
import { applyToDraft, type FlowAssistant } from "./flow-assistant";
import { useSuggestion } from "./use-suggestion";

/**
 * The popover of a field helper: an optional instruction with quick picks,
 * the agent's progress, then a preview of its suggestion to apply or
 * discard. Closing it stops the agent. Applying changes the draft only.
 */
export function SuggestPopover({
	assistant,
	kind,
	nodeId,
	open,
	onOpenChange,
	trigger,
	tooltip,
	anchor,
	finalFocus,
	title,
	description,
	picks,
	placeholder,
	selection,
	blocked,
	renderPreview,
}: {
	assistant: FlowAssistant;
	kind: SuggestionKind;
	nodeId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The button that opens it. */
	trigger: ReactElement;
	/** A label for an icon-only trigger. */
	tooltip?: ReactNode;
	/** What the popover opens beside. Default: the trigger. */
	anchor?: RefObject<HTMLElement | null>;
	/** Where the focus goes when it closes. Default: back where it was. */
	finalFocus?: RefObject<HTMLElement | null>;
	title: string;
	description: string;
	/** Two or three instructions to send with one click. */
	picks: readonly string[];
	placeholder: string;
	/** `prompt` only: the part of the prompt to rewrite. */
	selection?: TextRange;
	/** Why the suggestion cannot be applied now, or null. */
	blocked?: (suggestion: Suggestion) => string | null;
	renderPreview: (suggestion: Suggestion) => ReactNode;
}) {
	return (
		<Popover open={open} onOpenChange={(next) => onOpenChange(next)}>
			{tooltip ? (
				<Tooltip>
					<TooltipTrigger render={<PopoverTrigger render={trigger} />} />
					<TooltipContent>{tooltip}</TooltipContent>
				</Tooltip>
			) : (
				<PopoverTrigger render={trigger} />
			)}
			<PopoverContent
				anchor={anchor}
				side="left"
				align="start"
				sideOffset={12}
				finalFocus={finalFocus ?? true}
				className="max-h-[min(36rem,var(--available-height))] w-[min(26rem,var(--available-width))] gap-3 overflow-y-auto"
			>
				{open ? (
					<SuggestBody
						assistant={assistant}
						kind={kind}
						nodeId={nodeId}
						title={title}
						description={description}
						picks={picks}
						placeholder={placeholder}
						selection={selection}
						blocked={blocked}
						renderPreview={renderPreview}
						onClose={() => onOpenChange(false)}
					/>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

/** The popover's content. It mounts on open, so closing forgets the instruction and stops the agent. */
function SuggestBody({
	assistant,
	kind,
	nodeId,
	title,
	description,
	picks,
	placeholder,
	selection,
	blocked,
	renderPreview,
	onClose,
}: {
	assistant: FlowAssistant;
	kind: SuggestionKind;
	nodeId: string;
	title: string;
	description: string;
	picks: readonly string[];
	placeholder: string;
	selection?: TextRange;
	blocked?: (suggestion: Suggestion) => string | null;
	renderPreview: (suggestion: Suggestion) => ReactNode;
	onClose: () => void;
}) {
	const id = useId();
	const { state, start, stop } = useSuggestion();
	const [instruction, setInstruction] = useState("");
	const sent = useRef("");

	const send = (text: string) => {
		sent.current = text;
		start({
			projectId: assistant.projectId,
			flowName: assistant.flowName,
			flow: assistant.flow,
			nodeId,
			kind,
			instruction: text.trim(),
			...(selection ? { selection } : {}),
		});
	};

	const reason =
		state.status === "ready" ? (blocked?.(state.suggestion) ?? null) : null;

	return (
		<>
			<PopoverHeader>
				<PopoverTitle>{title}</PopoverTitle>
				<PopoverDescription className="text-xs">
					{description}
				</PopoverDescription>
			</PopoverHeader>

			{state.status === "idle" || state.status === "failed" ? (
				<>
					{state.status === "failed" ? (
						<Alert variant="destructive">
							<CircleAlertIcon />
							<AlertTitle>No suggestion</AlertTitle>
							<AlertDescription>{state.message}</AlertDescription>
						</Alert>
					) : null}
					<div className="flex flex-wrap gap-1">
						{picks.map((pick) => (
							<Button
								key={pick}
								variant="outline"
								size="xs"
								className="font-normal"
								onClick={() => {
									setInstruction(pick);
									send(pick);
								}}
							>
								{pick}
							</Button>
						))}
					</div>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							send(instruction);
						}}
					>
						<label htmlFor={`${id}-instruction`} className="sr-only">
							What should it do?
						</label>
						<InputGroup>
							<InputGroupTextarea
								id={`${id}-instruction`}
								autoFocus
								value={instruction}
								placeholder={placeholder}
								className="min-h-16 text-sm"
								onChange={(event) => setInstruction(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										send(instruction);
									}
								}}
							/>
							<InputGroupAddon align="block-end">
								<span className="text-muted-foreground text-xs">
									Leave it empty to let the agent choose.
								</span>
								<InputGroupButton
									type="submit"
									variant="default"
									size="xs"
									className="ml-auto"
								>
									{state.status === "failed" ? "Try again" : "Suggest"}
									<ArrowUpIcon data-icon="inline-end" />
								</InputGroupButton>
							</InputGroupAddon>
						</InputGroup>
					</form>
				</>
			) : null}

			{state.status === "running" ? (
				<div className="flex flex-col gap-3">
					<p
						className="flex items-center gap-2 text-muted-foreground text-xs"
						aria-live="polite"
					>
						<Spinner className="size-3.5" />
						<span className="truncate">
							{state.activity ?? "The agent reads the flow"}
						</span>
					</p>
					<div className="flex flex-col gap-1.5">
						<Skeleton className="h-3 w-full" />
						<Skeleton className="h-3 w-4/5" />
						<Skeleton className="h-3 w-3/5" />
					</div>
					<Button
						variant="outline"
						size="sm"
						className="self-start"
						onClick={stop}
					>
						Stop
					</Button>
				</div>
			) : null}

			{state.status === "ready" ? (
				<div className="flex flex-col gap-3">
					{state.suggestion.note ? (
						<p className="text-muted-foreground text-xs leading-relaxed">
							{state.suggestion.note}
						</p>
					) : null}
					{renderPreview(state.suggestion)}
					{reason ? (
						<Alert>
							<CircleAlertIcon />
							<AlertDescription>{reason}</AlertDescription>
						</Alert>
					) : null}
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							disabled={reason !== null}
							onClick={() => {
								applyToDraft(assistant, nodeId, state.suggestion, selection);
								onClose();
							}}
						>
							Apply
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => send(sent.current)}
						>
							Try again
						</Button>
						<Button variant="ghost" size="sm" onClick={onClose}>
							Discard
						</Button>
						<span className="ml-auto text-muted-foreground text-xs">
							<Kbd>Esc</Kbd> closes
						</span>
					</div>
				</div>
			) : null}
		</>
	);
}
