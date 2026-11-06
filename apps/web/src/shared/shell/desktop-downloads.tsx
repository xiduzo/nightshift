import { useEffect } from "react";
import { toast } from "sonner";

/** What the desktop app says about a download (`features/external` there). */
type DesktopDownload = {
	state: "started" | "completed" | "failed";
	id: string;
	name: string;
};

/**
 * Shows where a download goes in the desktop app. Its window has no download
 * list, and a browser shows none of this: the event never fires there.
 */
export function DesktopDownloads() {
	useEffect(() => {
		const show = (event: Event) => {
			const { state, id, name } = (event as CustomEvent<DesktopDownload>)
				.detail;
			if (state === "started") toast(`Downloading ${name}…`, { id });
			if (state === "completed") {
				toast.success(`${name} is in your Downloads folder.`, { id });
			}
			if (state === "failed") {
				toast.error(`The download of ${name} stopped. Try again.`, { id });
			}
		};
		window.addEventListener("nightshift:download", show);
		return () => window.removeEventListener("nightshift:download", show);
	}, []);
	return null;
}
