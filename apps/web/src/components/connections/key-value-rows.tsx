import { Button } from "@nightshift/ui/components/button";
import { FieldError } from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { cn } from "@nightshift/ui/lib/utils";
import { PlusIcon, XIcon } from "lucide-react";

export type KeyValueRow = { id: string; key: string; value: string };

let nextId = 0;
export function newRow(key = "", value = ""): KeyValueRow {
	nextId += 1;
	return { id: `row-${nextId}`, key, value };
}

export function rowsFrom(record: Record<string, string> | undefined) {
	return Object.entries(record ?? {}).map(([key, value]) => newRow(key, value));
}

export function recordFrom(rows: KeyValueRow[]): Record<string, string> {
	return Object.fromEntries(
		rows
			.filter((row) => row.key.trim() !== "")
			.map((row) => [row.key.trim(), row.value]),
	);
}

/**
 * A value that looks like a pasted token: long, one word, and no `${NAME}`.
 * `Bearer abc…` counts too. A hint, never a block.
 */
export function looksLikeToken(value: string): boolean {
	if (value.includes("${")) return false;
	const word = value.trim().replace(/^(bearer|token|basic)\s+/i, "");
	return word.length >= 20 && !/\s/.test(word) && /\d/.test(word);
}

/** Name = value pairs: a command server's environment or a URL server's headers. */
export function KeyValueRows({
	rows,
	onChange,
	keyLabel,
	keyPlaceholder,
	valuePlaceholder,
	addLabel,
}: {
	rows: KeyValueRow[];
	onChange: (rows: KeyValueRow[]) => void;
	keyLabel: string;
	keyPlaceholder: string;
	valuePlaceholder: string;
	addLabel: string;
}) {
	const update = (id: string, patch: Partial<KeyValueRow>) =>
		onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

	return (
		<div className="flex flex-col gap-2">
			{rows.map((row, index) => {
				const token = looksLikeToken(row.value);
				return (
					<div key={row.id} className="flex flex-col gap-1">
						<div className="flex items-center gap-2">
							<Input
								value={row.key}
								onChange={(event) =>
									update(row.id, { key: event.target.value })
								}
								placeholder={keyPlaceholder}
								aria-label={`${keyLabel} ${index + 1}`}
								className="w-2/5 font-mono"
								autoComplete="off"
								spellCheck={false}
							/>
							<Input
								value={row.value}
								onChange={(event) =>
									update(row.id, { value: event.target.value })
								}
								placeholder={valuePlaceholder}
								aria-label={`Value ${index + 1}`}
								className={cn(
									"min-w-0 flex-1 font-mono",
									token && "border-status-waiting/70",
								)}
								autoComplete="off"
								spellCheck={false}
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`Remove ${row.key || `row ${index + 1}`}`}
								onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
							>
								<XIcon />
							</Button>
						</div>
						{token ? (
							<FieldError className="text-status-waiting">
								This looks like a token. Write it as{" "}
								<span className="font-mono">${"{NAME}"}</span> and save the
								value under Secrets.
							</FieldError>
						) : null}
					</div>
				);
			})}
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => onChange([...rows, newRow()])}
			>
				<PlusIcon data-icon="inline-start" />
				{addLabel}
			</Button>
		</div>
	);
}
