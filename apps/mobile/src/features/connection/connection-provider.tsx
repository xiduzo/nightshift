import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import {
	forgetHostAddress,
	hostAddressOf,
	loadHostAddress,
	saveHostAddress,
} from "@/shared/api";
import { type Host, hostAt } from "./host";

export type Connection =
	| { status: "loading" }
	| { status: "signed-out"; address: string | null }
	| {
			status: "connected";
			host: Host;
			person: { name: string; email: string };
	  };

export type SignInResult = "signed-in" | "needs-code";

type ConnectionValue = {
	connection: Connection;
	/** Signs in at a Host. "needs-code" when the Host asks for a two-factor code. */
	signIn(input: {
		address: string;
		email: string;
		password: string;
	}): Promise<SignInResult>;
	/** Finishes a sign-in that needs a two-factor code. */
	verifyCode(code: string): Promise<void>;
	/** Signs out and forgets the Host. */
	signOut(): Promise<void>;
};

const ConnectionContext = createContext<ConnectionValue | null>(null);

/** What the person sees when the Host does not answer. */
const UNREACHABLE =
	"Night Shift cannot reach this Host. Check the address, and check that this phone is online.";

/**
 * The Host this phone is signed in to. The Host address is kept in
 * SecureStore, the session cookie too (per Host, by the auth client).
 */
export function ConnectionProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	/** undefined while SecureStore answers, null when there is no Host yet. */
	const [address, setAddress] = useState<string | null | undefined>();
	/** The Host of a sign-in that waits for its two-factor code. */
	const pending = useRef<Host | null>(null);

	useEffect(() => {
		loadHostAddress().then(
			(saved) => setAddress(saved ?? null),
			() => setAddress(null),
		);
	}, []);

	const host = useMemo(() => (address ? hostAt(address) : null), [address]);

	const session = useQuery({
		queryKey: ["connection", "session", address],
		enabled: host !== null,
		queryFn: async () => {
			if (!host) return null;
			const { data, error } = await host.auth.getSession();
			if (error) throw new Error(error.message ?? UNREACHABLE);
			return data;
		},
	});

	const connect = useCallback(
		async (next: Host) => {
			pending.current = null;
			await saveHostAddress(next.address);
			queryClient.removeQueries({ queryKey: ["connection"] });
			setAddress(next.address);
		},
		[queryClient],
	);

	const signIn = useCallback<ConnectionValue["signIn"]>(
		async ({ address: typed, email, password }) => {
			const address = hostAddressOf(typed);
			if (!address) {
				throw new Error(
					"Check the Host address. Example: nightshift.example.com",
				);
			}
			const next = hostAt(address);
			const result = await next.auth.signIn
				.email({ email: email.trim(), password })
				.catch(() => {
					throw new Error(UNREACHABLE);
				});
			if (result.error) {
				throw new Error(
					result.error.message ?? "Check your email and password.",
				);
			}
			if (
				result.data &&
				"twoFactorRedirect" in result.data &&
				result.data.twoFactorRedirect
			) {
				pending.current = next;
				return "needs-code";
			}
			await connect(next);
			return "signed-in";
		},
		[connect],
	);

	const verifyCode = useCallback<ConnectionValue["verifyCode"]>(
		async (code) => {
			const next = pending.current;
			if (!next) throw new Error("Sign in again to get a new code.");
			const result = await next.auth.twoFactor
				.verifyTotp({ code: code.trim() })
				.catch(() => {
					throw new Error(UNREACHABLE);
				});
			if (result.error) {
				throw new Error(
					result.error.message ?? "Check the code and try again.",
				);
			}
			await connect(next);
		},
		[connect],
	);

	const signOut = useCallback(async () => {
		await host?.auth.signOut().catch(() => undefined);
		await forgetHostAddress();
		queryClient.clear();
		setAddress(null);
	}, [host, queryClient]);

	const connection: Connection =
		address === undefined || (host && session.isPending)
			? { status: "loading" }
			: host && session.data
				? {
						status: "connected",
						host,
						person: {
							name: session.data.user.name,
							email: session.data.user.email,
						},
					}
				: { status: "signed-out", address };

	const value = useMemo(
		() => ({ connection, signIn, verifyCode, signOut }),
		[connection, signIn, verifyCode, signOut],
	);

	return (
		<ConnectionContext.Provider value={value}>
			{children}
		</ConnectionContext.Provider>
	);
}

export function useConnection(): ConnectionValue {
	const value = useContext(ConnectionContext);
	if (!value) {
		throw new Error("useConnection needs a ConnectionProvider around it.");
	}
	return value;
}
