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
