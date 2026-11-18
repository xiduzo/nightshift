import { TranscriptScreen } from "@/features/gates";
import { SignedInOnly } from "@/features/host";

export default function TranscriptRoute() {
	return (
		<SignedInOnly>
			<TranscriptScreen />
		</SignedInOnly>
	);
}
