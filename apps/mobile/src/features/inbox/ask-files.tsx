import type { AskAttachment } from "@nightshift/flows";
import * as WebBrowser from "expo-web-browser";
import {
	ExternalLink,
	FileText,
	Image as ImageIcon,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Image, View } from "react-native";

import { useSignedIn } from "@/features/host";
import { ListGroup, ListRow } from "@/shared/list";
import { askImageUrl } from "./ask-view";

/**
 * The files and links of an Ask, or of one of its choices: an image of a
 * run the Host walks shows inline, a link opens in the browser, and any
 * other file shows its name. The Host serves the images with this phone's
 * session, as it does the API.
 */
export function AskFiles({
	attachments,
	runId,
	address,
	walkedHere,
}: {
	attachments: readonly AskAttachment[];
	runId: string;
	address: string;
	walkedHere: boolean;
}) {
	const { host } = useSignedIn();
	// The session stays in memory here, never in the kept cache.
	const [cookie, setCookie] = useState<string | null>(null);
	useEffect(() => {
		let live = true;
		void Promise.resolve(host.auth.getCookie()).then((value) => {
			if (live) setCookie(value ?? "");
		});
		return () => {
			live = false;
		};
	}, [host]);
	const images = attachments.flatMap((attachment) => {
		const uri = askImageUrl(address, runId, attachment, walkedHere);
		return uri ? [{ attachment, uri }] : [];
	});
	const rows = attachments.filter(
		(attachment) =>
			askImageUrl(address, runId, attachment, walkedHere) === null,
	);
	return (
		<View className="gap-2">
			{cookie !== null
				? images.map(({ attachment, uri }) => (
						<Image
							key={uri}
							source={{
								uri,
								...(cookie ? { headers: { cookie } } : {}),
							}}
							accessibilityLabel={attachment.label}
							resizeMode="contain"
							className="aspect-video w-full rounded-lg bg-muted"
						/>
					))
				: null}
			{rows.length > 0 ? (
				<ListGroup>
					{rows.map((attachment, index) => {
						const { url } = attachment;
						return (
							<ListRow
								key={`${attachment.artifactId ?? url ?? ""}-${index}`}
								icon={
									url
										? ExternalLink
										: (attachment.mediaType ?? "").startsWith("image/")
											? ImageIcon
											: FileText
								}
								title={attachment.label}
								{...(url
									? {
											onPress: () => void WebBrowser.openBrowserAsync(url),
											accessibilityHint: "Opens the link in the browser",
										}
									: {
											caption: ["Open it in Night Shift on your computer."],
										})}
							/>
						);
					})}
				</ListGroup>
			) : null}
		</View>
	);
}
