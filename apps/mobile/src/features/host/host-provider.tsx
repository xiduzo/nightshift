import type { ApiQueryUtils } from "@nightshift/client";
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
	needsHttps,
	saveHostAddress,
} from "@/shared/api";
import { type Host, hostAt } from "./host";

/** The signed-in Person, as the Host knows them. */
export type Person = { name: string; email: string };

/** Whether this phone has a Host, and who is signed in to it. */
export type HostState =
	| { status: "loading" }
	| { status: "signed-out"; address: string | null }
	| { status: "signed-in"; host: Host; person: Person };

export type SignInResult = "signed-in" | "needs-code";

/** Where a two-factor code comes from: the authenticator app, or a backup code. */
export type CodeKind = "app" | "backup";

type HostValue = {
	state: HostState;
	/** Signs in at a Host. "needs-code" when the Host asks for a two-factor code. */
	signIn(input: {
		address: string;
		email: string;
		password: string;
	}): Promise<SignInResult>;
	/** Finishes a sign-in that needs a two-factor code. */
	verifyCode(code: string, kind: CodeKind): Promise<void>;
	/** Ends the session. The phone keeps the Host address for the next sign-in. */
	signOut(): Promise<void>;
	/** Ends the session and forgets the Host. */
	forget(): Promise<void>;
};

const HostContext = createContext<HostValue | null>(null);

/** What the person sees when the Host does not answer. */
const UNREACHABLE =
	"Night Shift cannot reach this Host. Check the address, and check that this phone is online.";

/** The query key of the session at one Host. */
function sessionKey(address: string | null | undefined) {
	return ["host", "session", address] as const;
}

/** Every query but the sessions: the data of the Host. */
function notOfHost(query: { queryKey: readonly unknown[] }): boolean {
	return query.queryKey[0] !== "host";
}

/** Who is signed in at a Host, or null. */
async function readSession(host: Host) {
	const { data, error } = await host.auth.getSession();
	if (error) throw new Error(error.message ?? UNREACHABLE);
	return data;
}

/**
 * The Host this phone is signed in to. The Host address is kept in
 * SecureStore, the session cookie too (per Host, by the auth client).
 */
export function HostProvider({ children }: { children: ReactNode }) {
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
		queryKey: sessionKey(address),
		enabled: host !== null,
		queryFn: () => (host ? readSession(host) : null),
	});

	/** Works with this Host from now on: its session, its data. */
	const enter = useCallback(
		async (next: Host) => {
			pending.current = null;
			const signedIn = await readSession(next);
			await saveHostAddress(next.address);
			queryClient.removeQueries({ predicate: notOfHost });
			queryClient.setQueryData(sessionKey(next.address), signedIn);
			setAddress(next.address);
		},
		[queryClient],
	);

	const signIn = useCallback<HostValue["signIn"]>(
		async ({ address: typed, email, password }) => {
			const address = hostAddressOf(typed);
			if (!address) {
				throw new Error(
					needsHttps(typed)
						? "A Host needs an https:// address. Example: https://nightshift.example.com"
						: "Check the Host address. Example: nightshift.example.com",
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
			await enter(next);
			return "signed-in";
		},
		[enter],
	);

	const verifyCode = useCallback<HostValue["verifyCode"]>(
		async (code, kind) => {
			const next = pending.current;
			if (!next) throw new Error("Sign in again to get a new code.");
			const twoFactor = next.auth.twoFactor;
			const result = await (kind === "backup"
				? twoFactor.verifyBackupCode({ code: code.trim() })
				: twoFactor.verifyTotp({ code: code.trim() })
			).catch(() => {
				throw new Error(UNREACHABLE);
			});
			if (result.error) {
				throw new Error(
					result.error.message ?? "Check the code and try again.",
				);
			}
			await enter(next);
		},
		[enter],
	);

	const signOut = useCallback(async () => {
		if (!host) return;
		await host.auth.signOut().catch(() => undefined);
		queryClient.setQueryData(sessionKey(host.address), null);
		queryClient.removeQueries({ predicate: notOfHost });
	}, [host, queryClient]);

	const forget = useCallback(async () => {
		await signOut();
		await forgetHostAddress();
		setAddress(null);
	}, [signOut]);

	const state: HostState =
		address === undefined || (host && session.isPending)
			? { status: "loading" }
			: host && session.data
				? {
						status: "signed-in",
						host,
						person: {
							name: session.data.user.name,
							email: session.data.user.email,
						},
					}
				: { status: "signed-out", address };

	const value = useMemo(
		() => ({ state, signIn, verifyCode, signOut, forget }),
		[state, signIn, verifyCode, signOut, forget],
	);

	return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

/** This phone's Host: whether someone is signed in, and how to sign in or out. */
export function useHost(): HostValue {
	const value = useContext(HostContext);
	if (!value) {
		throw new Error("useHost needs a HostProvider around it.");
	}
	return value;
}

/**
 * The Host and the Person of a screen behind the sign-in. The tabs render
 * only when someone is signed in, so their screens may use it.
 */
export function useSignedIn(): { host: Host; person: Person } {
	const { state } = useHost();
	if (state.status !== "signed-in") {
		throw new Error("useSignedIn needs a signed-in Host.");
	}
	return state;
}

/**
 * The query options of a vertical on the signed-in Host:
 * `useHostQueries(createRunQueries)`. They change when the Host does.
 */
export function useHostQueries<T>(factory: (orpc: ApiQueryUtils) => T): T {
	const { host } = useSignedIn();
	return useMemo(() => factory(host.orpc), [factory, host.orpc]);
}
