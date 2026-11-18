import { Field, FieldLabel } from "@nightshift/ui/components/field";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@nightshift/ui/components/input-group";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { ArrowUpIcon } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";

/** Ask searches what agents would find. Tell adds to it. */
export type BoxMode = "ask" | "tell";

const PLACEHOLDER: Record<BoxMode, string> = {
	ask: "Ask what your agents would find, for example: when do invoices go out?",
	tell: "Tell a fact, paste a link, or say where something lives",
};

/**
 * The one box of the Knowledge overview: Ask searches as you type, Tell
 * sends with Enter or the arrow. Shift+Enter starts a new line. What the
 * box found in the text (its links) shows inside it, under the text.
 */
export function AskTellBox({
	mode,
	onMode,
	text,
	onText,
	onSend,
	tells,
	sending,
	blockedBy,
	inside,
}: {
	mode: BoxMode;
	onMode: (mode: BoxMode) => void;
	text: string;
	onText: (text: string) => void;
	onSend: () => void;
	/** The person may tell: without it, the box only asks. */
	tells: boolean;
	sending: boolean;
	/** Why Tell cannot send now, or null. */
	blockedBy: string | null;
	/** What the box shows under the text, such as the links it found. */
	inside?: ReactNode;
}) {
	const id = useId();
	const form = useRef<HTMLFormElement>(null);
	const canSend =
		mode === "tell" && text.trim() !== "" && !sending && blockedBy === null;
	return (
		<form
			ref={form}
			onSubmit={(event) => {
				event.preventDefault();
				if (canSend) onSend();
			}}
		>
			<Field className="gap-1.5">
				<FieldLabel htmlFor={id} className="sr-only">
					{mode === "ask" ? "Ask your knowledge" : "Tell your agents"}
				</FieldLabel>
				<InputGroup className="bg-card">
					<InputGroupTextarea
						id={id}
						value={text}
						placeholder={PLACEHOLDER[mode]}
						className="max-h-60 min-h-20 text-base"
						onChange={(event) => onText(event.target.value)}
						onKeyDown={(event) => {
							// Enter tells, Shift+Enter starts a new line. Not while an IME composes.
							if (
								mode !== "tell" ||
								event.key !== "Enter" ||
								event.shiftKey ||
								event.nativeEvent.isComposing
							)
								return;
							event.preventDefault();
							form.current?.requestSubmit();
						}}
					/>
					{inside}
					<InputGroupAddon align="block-end">
						{tells ? (
							<ToggleGroup
								size="sm"
								variant="outline"
								spacing={0}
								aria-label="Ask or tell"
								value={[mode]}
								onValueChange={(next) => {
									const picked = next[0];
									if (picked === "ask" || picked === "tell") onMode(picked);
								}}
							>
								<ToggleGroupItem value="ask">Ask</ToggleGroupItem>
								<ToggleGroupItem value="tell">Tell</ToggleGroupItem>
							</ToggleGroup>
						) : null}
						{mode === "tell" ? (
							<InputGroupButton
								type="submit"
								variant="default"
								size="icon-xs"
								className="ml-auto rounded-full"
								aria-label="Tell"
								title={
									blockedBy ?? "Tell (Enter). Shift + Enter starts a new line."
								}
								disabled={!canSend}
							>
								{sending ? <Spinner /> : <ArrowUpIcon />}
							</InputGroupButton>
						) : null}
					</InputGroupAddon>
				</InputGroup>
			</Field>
		</form>
	);
}
