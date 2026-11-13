import { Label } from "@nightshift/ui/components/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import type { ReactNode } from "react";

/**
 * A list of settings as a table: what a setting is on the left, its control
 * on the right. The same frame holds every list of the Settings pages.
 */
export function SettingRows({
	first = "Setting",
	second = "Value",
	children,
}: {
	/** The head of the first column. */
	first?: string;
	second?: string;
	children: ReactNode;
}) {
	return (
		<div className="overflow-x-auto rounded-xl border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-1/2 px-3">{first}</TableHead>
						<TableHead className="px-3">{second}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>{children}</TableBody>
			</Table>
		</div>
	);
}

/** One setting: its name and one line, then its control. */
export function SettingRow({
	label,
	htmlFor,
	description,
	error,
	children,
}: {
	label: ReactNode;
	/** The id of the control, so the name is its label. */
	htmlFor?: string;
	description?: ReactNode;
	error?: ReactNode;
	children: ReactNode;
}) {
	return (
		<TableRow>
			<TableCell className="whitespace-normal px-3 py-2.5 align-top">
				{htmlFor ? (
					<Label htmlFor={htmlFor} className="leading-5">
						{label}
					</Label>
				) : (
					<span className="font-medium">{label}</span>
				)}
				{description ? (
					<div className="mt-0.5 text-muted-foreground text-xs">
						{description}
					</div>
				) : null}
				{error ? (
					<div role="alert" className="mt-0.5 text-destructive text-xs">
						{error}
					</div>
				) : null}
			</TableCell>
			<TableCell className="whitespace-normal px-3 py-2.5">
				<div className="flex min-w-0 max-w-80 items-center gap-2">
					{children}
				</div>
			</TableCell>
		</TableRow>
	);
}

/** A message between the rows, over the full width: a lock, an error. */
export function SettingNote({ children }: { children: ReactNode }) {
	return (
		<TableRow className="hover:bg-transparent">
			<TableCell colSpan={2} className="whitespace-normal px-3 py-2.5">
				{children}
			</TableCell>
		</TableRow>
	);
}
