import { Button } from "@nightshift/ui/components/button";
import { ButtonGroup } from "@nightshift/ui/components/button-group";
import { CopyIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";

import { backupCodesFile } from "./two-factor";

/**
 * Backup codes, shown once: each signs in one time without the app. The
 * person copies them or saves them as a file.
 */
export function BackupCodes({
	codes,
	email,
	onSaved,
}: {
	codes: readonly string[];
	email: string;
	/** The person copied or downloaded them. */
	onSaved?: () => void;
}) {
	const text = backupCodesFile(codes, email);

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			toast.success("Backup codes copied");
			onSaved?.();
		} catch {
			toast.error("Could not copy. Allow this page to use the clipboard.");
		}
	}

	function download() {
		const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = "night-shift-backup-codes.txt";
		link.click();
		URL.revokeObjectURL(url);
		onSaved?.();
	}

	return (
		<div className="flex flex-col gap-3">
			<ul
				aria-label="Backup codes"
				className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border bg-muted/40 p-4 font-mono text-sm"
			>
				{codes.map((code) => (
					<li key={code}>{code}</li>
				))}
			</ul>
			<ButtonGroup>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => void copy()}
				>
					<CopyIcon data-icon="inline-start" />
					Copy
				</Button>
				<Button type="button" variant="outline" size="sm" onClick={download}>
					<DownloadIcon data-icon="inline-start" />
					Download
				</Button>
			</ButtonGroup>
		</div>
	);
}
