/** The parts the transcript items share: a section break, a folded prompt, a result card. */
import { Bubble, BubbleContent } from "@nightshift/ui/components/bubble";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { Marker, MarkerContent } from "@nightshift/ui/components/marker";
import {
	Message,
	MessageContent,
	MessageHeader,
} from "@nightshift/ui/components/message";
import { cn } from "@nightshift/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { hoverTime } from "@/shared/format";

/** A section break in the transcript: a session, an element, a decision. */
export function Divider({
	title,
	at,
	details,
}: {
	title: ReactNode;
	at: number;
	details: (string | null | undefined)[];
}) {
	return (
		<Marker variant="separator" className="text-xs">
			<MarkerContent>
				<h3 className="inline font-medium text-foreground">{title}</h3>
				<span title={hoverTime(at)}>
					{" "}
					· {details.filter(Boolean).join(" · ")}
				</span>
			</MarkerContent>
		</Marker>
	);
}

/** Prompts longer than this many lines start folded. */
const PROMPT_FOLD_LINES = 12;

/** A prompt to the agent or the model, as a message bubble on the right. */
export function PromptBubble({
	label,
	prompt,
	empty,
	children,
}: {
	label: string;
	prompt: string;
	/** Shown in place of an empty prompt. */
	empty: string;
	children?: ReactNode;
}) {
	const long =
		prompt.split("\n").length > PROMPT_FOLD_LINES || prompt.length > 1200;
	const [open, setOpen] = useState(false);
	return (
		<Message align="end">
			<MessageContent>
				<MessageHeader className="justify-end">{label}</MessageHeader>
				<Bubble variant="muted" align="end" className="max-w-[92%]">
					<BubbleContent className="flex flex-col gap-2">
						{prompt.trim() === "" ? (
							<p className="text-muted-foreground italic">{empty}</p>
						) : (
							<p
								className={cn(
									"whitespace-pre-wrap break-words",
									long && !open && "line-clamp-[12]",
								)}
							>
								{prompt}
							</p>
						)}
						{long ? (
							<Button
								variant="link"
								size="xs"
								className="self-start px-0"
								aria-expanded={open}
								onClick={() => setOpen((value) => !value)}
							>
								{open ? "Show less" : "Show the whole prompt"}
							</Button>
						) : null}
						{children}
					</BubbleContent>
				</Bubble>
			</MessageContent>
		</Message>
	);
}

/** A result in the transcript: a report, a decision, an answer. */
export function ResultCard({
	icon: Icon,
	kicker,
	value,
	tone,
	extra,
	children,
	className,
}: {
	icon: LucideIcon;
	kicker?: string;
	value: ReactNode;
	/** Text colour class of the outcome. */
	tone: string;
	extra?: ReactNode;
	children?: ReactNode;
	className?: string;
}) {
	return (
		// Inset ring: transcript items skip painting offscreen (content-visibility), which clips an outer ring.
		<Card size="sm" className={cn("ring-inset", className)}>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-normal text-xs">
					<Icon className={cn("size-4", tone)} aria-hidden="true" />
					{kicker ? (
						<span className="text-muted-foreground">{kicker}</span>
					) : null}
					<span className={cn("font-medium", tone)}>{value}</span>
					{extra}
				</CardTitle>
			</CardHeader>
			{children ? <CardContent>{children}</CardContent> : null}
		</Card>
	);
}
