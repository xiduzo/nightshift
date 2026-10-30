import type { Suggestion, SuggestionKind, TextRange } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { TraceLine, TraceTitle } from "@nightshift/ui/components/trace";
import { CircleAlertIcon } from "lucide-react";
import {
	type ReactElement,
	type ReactNode,
	type RefObject,
	useRef,
	useState,
} from "react";
import { Markdown } from "@/shared/markdown";
import { AgentMenus, agentRequest } from "./agent-picker";
import {
	applyToDraft,
	type FlowAssistant,
	INSPECTOR_SELECTOR,
} from "./flow-assistant";
import { PromptInput } from "./prompt-input";
import { Suggestions } from "./suggestions";
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
	toolSchema,
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
	/** The node whose field it fills. Unset for a field of the flow. */
	nodeId?: string;
	/** `arguments` only: the tool's input schema, as the editor knows it. */
	toolSchema?: Record<string, unknown>;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The button that opens it. */
	trigger: ReactElement;
	/** A label for an icon-only trigger. */
	tooltip?: ReactNode;
	/**
	 * What the popover opens beside. Default: the inspector's left edge, at
	 * the height of the trigger, so the popover covers no field.
	 */
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
	const triggerRef = useRef<HTMLButtonElement>(null);
	return (
		<Popover open={open} onOpenChange={(next) => onOpenChange(next)}>
			{tooltip ? (
				<Tooltip>
					<TooltipTrigger
						render={<PopoverTrigger ref={triggerRef} render={trigger} />}
					/>
					<TooltipContent>{tooltip}</TooltipContent>
				</Tooltip>
			) : (
				<PopoverTrigger ref={triggerRef} render={trigger} />
			)}
			<PopoverContent
				anchor={anchor ?? (() => besideInspector(triggerRef.current))}
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
						toolSchema={toolSchema}
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

/**
 * A point on the inspector's left edge, at the height of `trigger`: the
 * popover opens to the left of the inspector, not over it. The trigger
 * itself outside an inspector.
 */
function besideInspector(trigger: HTMLElement | null) {
	if (!trigger) return null;
	const panel = trigger.closest(INSPECTOR_SELECTOR);
	if (!panel) return trigger;
	return {
		contextElement: trigger,
		getBoundingClientRect: () => {
			const at = trigger.getBoundingClientRect();
			const edge = panel.getBoundingClientRect();
			return new DOMRect(edge.left, at.top, 0, at.height);
		},
	};
}

/** The popover's content. It mounts on open, so closing forgets the instruction and stops the agent. */
function SuggestBody({
	assistant,
	kind,
	nodeId,
	toolSchema,
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
	nodeId?: string;
	toolSchema?: Record<string, unknown>;
	title: string;
	description: string;
	picks: readonly string[];
	placeholder: string;
	selection?: TextRange;
	blocked?: (suggestion: Suggestion) => string | null;
	renderPreview: (suggestion: Suggestion) => ReactNode;
	onClose: () => void;
}) {
	const { state, start, stop } = useSuggestion();
	const [instruction, setInstruction] = useState("");
	const sent = useRef("");

	const send = (text: string) => {
		sent.current = text;
		start({
			projectId: assistant.projectId,
			flowName: assistant.flowName,
			flow: assistant.flow,
			...agentRequest(),
			...(nodeId ? { nodeId } : {}),
			kind,
			instruction: text.trim(),
			...(selection ? { selection } : {}),
			...(toolSchema ? { toolSchema } : {}),
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

			{state.status === "failed" ? (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>No suggestion</AlertTitle>
					<AlertDescription>{state.message}</AlertDescription>
				</Alert>
			) : null}

			{state.status === "running" ? (
				<div className="flex flex-col gap-3">
					<TraceLine status="running" aria-live="polite" className="text-xs">
						<TraceTitle>
							{state.activity ?? "The agent reads the flow"}
						</TraceTitle>
					</TraceLine>
					<div className="flex flex-col gap-1.5">
						<Skeleton className="h-3 w-full" />
						<Skeleton className="h-3 w-4/5" />
						<Skeleton className="h-3 w-3/5" />
					</div>
				</div>
			) : null}

			{state.status !== "ready" ? (
				<>
					{state.status !== "running" ? (
						<Suggestions
							items={picks}
							wrap
							onPick={(pick) => {
								setInstruction(pick);
								send(pick);
							}}
						/>
					) : null}
					<PromptInput
						label="What should it do?"
						autoFocus
						allowEmpty
						value={instruction}
						onValueChange={setInstruction}
						onSubmit={send}
						placeholder={placeholder}
						hint="Leave it empty to let the agent choose."
						submitLabel={state.status === "failed" ? "Try again" : "Suggest"}
						answering={state.status === "running"}
						onStop={stop}
						tools={<AgentMenus purpose="suggest" />}
					/>
				</>
			) : null}

			{state.status === "ready" ? (
				<div className="flex flex-col gap-3">
					{state.suggestion.note ? (
						<Markdown
							text={state.suggestion.note}
							className="text-muted-foreground text-xs"
						/>
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
