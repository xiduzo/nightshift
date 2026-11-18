import type { OutcomeColor } from "@nightshift/flows";
import { type ReactNode, useEffect, useRef } from "react";

import type { HeaderItem } from "@/shared/header";
import { NativeButtonRow, NativeSection } from "@/shared/native-list";

/**
 * What the button that sends an answer shows: the option you chose, in
 * its flow color, and the button. In the Needs you queue it is the bar
 * above the tabs. On the Gate screen it is the last row of the page.
 */
export type AnswerBar = {
	/** The option you chose. Null before you choose. */
	choice: {
		name: string;
		color: OutcomeColor | null;
		/** A red option: it stops work. */
		destructive: boolean;
	} | null;
	/** What shows before you choose: "Choose an answer". */
	prompt: string;
	/** The button. Null when you cannot send from here. */
	action: {
		label: string;
		/** The label while it works: "Signing off…". */
		busyLabel: string;
		busy: boolean;
		disabled: boolean;
	} | null;
};

/**
 * A Gate or a run in the Needs you queue: `lead` shows at the top of
 * the page (what you sent, what went wrong), `right` in the header
 * (Skip). The page gives its bar and its send to `onBar`: the bar above
 * the tabs shows it. After the answer the queue moves on, so no Sent
 * part shows.
 */
export type GateQueue = {
	lead: ReactNode;
	right: readonly HeaderItem[];
	onBar: (bar: AnswerBar | null, send: () => void) => void;
};

function nothing() {}

/**
 * Gives the page's bar and send to the queue after each render, and
 * takes them away when the page goes. Nothing outside the queue.
 */
export function useQueueBar(
	queue: GateQueue | undefined,
	bar: AnswerBar,
	send: () => void,
) {
	const onBar = useRef(queue?.onBar);
	onBar.current = queue?.onBar;
	useEffect(() => {
		onBar.current?.(bar, send);
	});
	useEffect(() => () => onBar.current?.(null, nothing), []);
}

/** The bar as the last group of a page that has no bar above the tabs. */
export function SendSection({
	bar,
	onSend,
	footer,
}: {
	bar: AnswerBar;
	onSend: () => void;
	footer?: string;
}) {
	const { action } = bar;
	if (!action) return null;
	return (
		<NativeSection footer={footer}>
			<NativeButtonRow
				label={action.busy ? action.busyLabel : action.label}
				destructive={bar.choice?.destructive}
				disabled={action.disabled || action.busy}
				onPress={onSend}
			/>
		</NativeSection>
	);
}
