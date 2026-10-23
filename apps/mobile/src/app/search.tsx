import { SignedInOnly } from "@/features/host";
import { SearchScreen } from "@/features/search";

export default function SearchRoute() {
	return (
		<SignedInOnly>
			<SearchScreen />
		</SignedInOnly>
	);
}
