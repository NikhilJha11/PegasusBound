import Request from "../../Request";
import type { OAuthStartResponse } from "./onboardOAuthStart";

// Starts an OAuth round trip that renews an existing mailbox's tokens after
// the provider invalidated them (password change, revoked grant). The finish
// leg is the ordinary onboardOAuthFinish with the returned state.
export default async function reauthEmailOAuth(mailboxId: string): Promise<OAuthStartResponse> {
    return await Request<OAuthStartResponse>({
        method: "POST",
        url: `/emails/onboarding/oauth/reauth/${mailboxId}`,
        authorization: true,
    });
}
