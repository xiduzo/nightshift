import { flowNameSchema } from "@nightshift/flows";

/** The name an imported flow gets when its file name is no flow name. */
const FALLBACK_NAME = "imported-flow";

/**
 * The flow name a file suggests: `Build Check.json` → `build-check`. A
 * name the project has already gets a suffix when Night Shift saves it.
 */
export function flowNameOfFile(fileName: string): string {
	const name = fileName
		.replace(/\.json$/i, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+/, "")
		.slice(0, 60)
		.replace(/-+$/, "");
	return flowNameSchema.safeParse(name).success ? name : FALLBACK_NAME;
}

/** Hands the person a file to save, as the browser downloads one. */
export function saveFile(fileName: string, text: string): void {
	const url = URL.createObjectURL(
		new Blob([text], { type: "application/json" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
