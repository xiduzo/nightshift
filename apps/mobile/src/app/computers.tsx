import { ComputersScreen } from "@/features/devices";
import { SignedInOnly } from "@/features/host";

export default function ComputersRoute() {
	return (
		<SignedInOnly>
			<ComputersScreen />
		</SignedInOnly>
	);
}
