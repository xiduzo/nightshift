import { SignedInOnly } from "@/features/host";
import { TranscriptScreen } from "@/features/inbox";

export default function TranscriptRoute() {
	return (
		<SignedInOnly>
			<TranscriptScreen />
		</SignedInOnly>
	);
}
