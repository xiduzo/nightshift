import { useCallback, useRef, useState } from "react";

import { type Caret, scrollTopNear } from "./caret";

/**
 * The state of a field that opens in a larger window. The field shows in
 * one place at a time: on the page, or in the window. Give the field
 * `ref={attach}` in both places. The cursor and the selection move along,
 * and the field scrolls to the cursor when it shows.
 */
export function useLargerWindow<
	T extends HTMLTextAreaElement | HTMLInputElement = HTMLTextAreaElement,
>() {
	const ref = useRef<T | null>(null);
	const [open, setOpen] = useState(false);
	const caret = useRef<Caret | null>(null);

	const show = useCallback((next: boolean) => {
		const field = ref.current;
		caret.current =
			field && field.selectionStart !== null && field.selectionEnd !== null
				? [field.selectionStart, field.selectionEnd]
				: null;
		setOpen(next);
	}, []);

	const attach = useCallback((field: T | null) => {
		ref.current = field;
		if (!field || !caret.current) return;
		const [start, end] = caret.current;
		field.setSelectionRange(start, end);
		field.scrollTop = scrollTopNear(
			field.value,
			start,
			field.scrollHeight,
			field.clientHeight,
		);
		caret.current = null;
	}, []);

	return { open, show, attach, ref };
}
