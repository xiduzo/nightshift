import type { JsonValue } from "@nightshift/flows";
import Papa from "papaparse";
import { ConvertProblem, cellText, columnsOf, recordsOf } from "./problem";

/**
 * CSV with papaparse. The first row names the columns; every row becomes a
 * record of text, one key per column, "" for a cell the row leaves out. No
 * cell is read as a number: "007" stays "007". Reading guesses the
 * delimiter unless the node sets one; writing uses a comma by default.
 */

/**
 * What papaparse reports that is no problem here: one column (no delimiter
 * to guess, a comma is fine) and a short row (its missing cells are "").
 */
const FINE = new Set(["UndetectableDelimiter", "TooFewFields"]);

export function readCsv(
	text: string,
	delimiter: string | undefined,
): Record<string, string>[] {
	const parsed = Papa.parse<Record<string, string | undefined>>(
		text.replace(/^\uFEFF/, ""),
		{
			header: true,
			skipEmptyLines: "greedy",
			delimiter: delimiter ?? "",
		},
	);
	const problem = parsed.errors.find((error) => !FINE.has(error.code));
	if (problem !== undefined) {
		const row = problem.row === undefined ? "" : ` in row ${problem.row + 2}`;
		throw new ConvertProblem(
			problem.code === "TooManyFields"
				? `The CSV has more cells${row} than columns in its first row. Check the delimiter, or give the extra cells a column.`
				: `The CSV is not valid${row}: ${problem.message}.`,
		);
	}
	const columns = parsed.meta.fields ?? [];
	return parsed.data.map((row) =>
		Object.fromEntries(columns.map((column) => [column, row[column] ?? ""])),
	);
}

export function writeCsv(
	value: JsonValue,
	delimiter: string | undefined,
): string {
	const records = recordsOf(value, "CSV");
	const columns = columnsOf(records);
	return Papa.unparse(
		{
			fields: columns,
			data: records.map((record) =>
				columns.map((column) => cellText(record[column])),
			),
		},
		{ delimiter: delimiter ?? ",", newline: "\n" },
	);
}
