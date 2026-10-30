import {
	Field,
	FieldDescription,
	FieldLabel,
} from "@nightshift/ui/components/field";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@nightshift/ui/components/input-group";
import { cn } from "@nightshift/ui/lib/utils";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";

const SEND_TITLE = "Send (Enter). Shift + Enter starts a new line.";

/**
 * The message box of the agent chat and of each Suggest popover (the AI
 * Elements Prompt Input): a text box over a row with the agent's menus
 * and Send. Enter sends, Shift+Enter starts a new line. While the agent
 * answers, Send becomes Stop. Send waits until there is something to send.
 */
export function PromptInput({
	value,
	onValueChange,
	onSubmit,
	label,
	placeholder,
	hint,
	blockedBy = null,
	answering = false,
	onStop,
	allowEmpty = false,
	submitLabel,
	tools,
	autoFocus,
	className,
	textareaClassName,
}: {
	value: string;
	onValueChange: (value: string) => void;
	onSubmit: (value: string) => void;
	/** The text box's name for a screen reader. */
	label: string;
	placeholder?: string;
	/** A line under the box. `blockedBy` takes its place. */
	hint?: string;
	/** Why the person cannot send now, or null when they can. */
	blockedBy?: string | null;
	/** The agent answers now: Send becomes Stop. */
	answering?: boolean;
	onStop?: () => void;
	/** An empty message sends too: the agent chooses. */
	allowEmpty?: boolean;
	/** Words on Send. Without them, Send is an arrow. */
	submitLabel?: string;
	/** In the row under the text, before Send: the agent's menus. */
	tools?: ReactNode;
	autoFocus?: boolean;
	className?: string;
	textareaClassName?: string;
}) {
	const id = useId();
	const form = useRef<HTMLFormElement>(null);
	const canSend =
		!answering && blockedBy === null && (allowEmpty || value.trim() !== "");
	const description = blockedBy ?? hint;
	return (
		<form
			ref={form}
			className={className}
			onSubmit={(event) => {
				event.preventDefault();
				if (canSend) onSubmit(value);
			}}
		>
			<Field className="gap-1.5">
				<FieldLabel htmlFor={id} className="sr-only">
					{label}
				</FieldLabel>
				<InputGroup>
					<InputGroupTextarea
						id={id}
						autoFocus={autoFocus}
						value={value}
						placeholder={placeholder}
						aria-describedby={description ? `${id}-hint` : undefined}
						className={cn("max-h-40 min-h-16 text-sm", textareaClassName)}
						onChange={(event) => onValueChange(event.target.value)}
						onKeyDown={(event) => {
							// Enter sends, Shift+Enter starts a new line. Not while an IME composes.
							if (
								event.key !== "Enter" ||
								event.shiftKey ||
								event.nativeEvent.isComposing
							)
								return;
							event.preventDefault();
							form.current?.requestSubmit();
						}}
					/>
					<InputGroupAddon align="block-end" className="min-w-0">
						{tools}
						{answering ? (
							<InputGroupButton
								variant="outline"
								size="icon-xs"
								className="ml-auto"
								aria-label="Stop"
								title="Stop the agent"
								onClick={onStop}
							>
								<SquareIcon />
							</InputGroupButton>
						) : submitLabel ? (
							<InputGroupButton
								type="submit"
								variant="default"
								size="xs"
								className="ml-auto"
								title={SEND_TITLE}
								disabled={!canSend}
							>
								{submitLabel}
								<ArrowUpIcon data-icon="inline-end" />
							</InputGroupButton>
						) : (
							<InputGroupButton
								type="submit"
								variant="default"
								size="icon-xs"
								className="ml-auto"
								aria-label="Send"
								title={SEND_TITLE}
								disabled={!canSend}
							>
								<ArrowUpIcon />
							</InputGroupButton>
						)}
					</InputGroupAddon>
				</InputGroup>
				{description ? (
					<FieldDescription id={`${id}-hint`} className="px-1 text-xs">
						{description}
					</FieldDescription>
				) : null}
			</Field>
		</form>
	);
}
