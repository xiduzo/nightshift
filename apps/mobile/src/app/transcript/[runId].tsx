import { SignedInOnly } from "@/features/access";
import { TranscriptScreen } from "@/features/gates";

export default function TranscriptRoute() {
	return (
		<SignedInOnly>
			<TranscriptScreen />
		</SignedInOnly>
	);
}
