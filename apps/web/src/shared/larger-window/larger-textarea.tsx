import { Textarea } from "@nightshift/ui/components/textarea";
import { cn } from "@nightshift/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";
import { CodeTextarea } from "@/shared/code";

import {
	LARGER_FIELD,
	LargerWindow,
	LargerWindowButton,
} from "./larger-window";
import { useLargerWindow } from "./use-larger-window";

/**
 * A shadcn Textarea that opens in a larger window to edit, from a button
 * in its corner. The window edits the same value as you type, and Done or
 * Escape closes it. With a `language` or `marks` it is a `CodeTextarea`,
 * highlighted the same in both places. A disabled field does not open. A
 * read-only one opens to read.
 */
export function LargerTextarea({
	title,
	language,
	marks,
	className,
	...props
}: Omit<ComponentProps<typeof Textarea>, "value" | "ref"> & {
	value: string;
	/** The field's label: the title of the larger window. */
	title: ReactNode;
	/** The code in the field, such as `json`, to highlight. */
	language?: string;
	/** A global pattern; each match gets a background. */
	marks?: RegExp;
}) {
	const larger = useLargerWindow();
	const field = (large: boolean) => {
		const shared = {
			...props,
			ref: larger.attach,
			className: cn(className, large ? LARGER_FIELD : "pr-9"),
		};
		return language !== undefined || marks !== undefined ? (
			<CodeTextarea {...shared} language={language} marks={marks} />
		) : (
			<Textarea {...shared} />
		);
	};

	return (
		<>
			{larger.open ? null : (
				<div className="relative">
					{field(false)}
					{props.disabled ? null : (
						<LargerWindowButton onClick={() => larger.show(true)} />
					)}
				</div>
			)}
			{/* The same field, larger. Only one of the two is on the page. */}
			<LargerWindow
				open={larger.open}
				onOpenChange={larger.show}
				title={title}
				field={larger.ref}
			>
				{field(true)}
			</LargerWindow>
		</>
	);
}
