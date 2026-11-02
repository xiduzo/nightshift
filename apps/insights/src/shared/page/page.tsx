import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import type { ReactNode } from "react";

/** The page title and the one line under it. */
export function Page({
	title,
	detail,
	children,
}: {
	title: string;
	detail: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-6 p-6">
			<div className="flex flex-col gap-1">
				<h1 className="font-medium text-2xl">{title}</h1>
				<p className="max-w-2xl text-muted-foreground text-sm">{detail}</p>
			</div>
			{children}
		</div>
	);
}

/** A group of stat cards. */
export function Stats({ children }: { children: ReactNode }) {
	return (
		<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
	);
}

/** One number and its caption. */
export function Stat({ label, value }: { label: string; value: string }) {
	return (
		<Card>
			<CardHeader>
				<CardDescription>{label}</CardDescription>
				<CardTitle className="tabular-nums">{value}</CardTitle>
			</CardHeader>
		</Card>
	);
}

/** A titled block under the page title. */
export function Section({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="font-medium text-lg">{title}</h2>
			{children}
		</section>
	);
}

/** A list of columns, built from the Table component. */
export function Columns({
	headers,
	rows,
}: {
	headers: string[];
	rows: ReactNode[][];
}) {
	return (
		<div className="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						{headers.map((header) => (
							<TableHead key={header}>{header}</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row, index) => (
						<TableRow key={`${headers[0] ?? "row"}-${index}`}>
							{row.map((cell, cellIndex) => (
								<TableCell
									key={`${headers[cellIndex] ?? cellIndex}`}
									className="tabular-nums"
								>
									{cell}
								</TableCell>
							))}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

/** Nothing in this list yet. */
export function EmptyNote({ title }: { title: string }) {
	return (
		<Empty>
			<EmptyHeader>
				<EmptyTitle>{title}</EmptyTitle>
			</EmptyHeader>
		</Empty>
	);
}

/** The numbers are still loading, or the load failed. */
export function LoadState({
	pending,
	error,
	children,
}: {
	pending: boolean;
	error: boolean;
	children: ReactNode;
}) {
	if (error) {
		return (
			<Alert variant="destructive">
				<AlertTitle>The numbers did not load.</AlertTitle>
				<AlertDescription>Refresh the page.</AlertDescription>
			</Alert>
		);
	}
	if (pending) {
		return (
			<p className="text-muted-foreground text-sm">Loading the numbers.</p>
		);
	}
	return children;
}
