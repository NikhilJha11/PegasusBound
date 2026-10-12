import Request from "../../Request";

export interface AuthorizeConsentInput {
    response_type: string;
    client_id: string;
    redirect_uri: string;
    scope: string;
    state: string;
    code_challenge: string;
    code_challenge_method: string;
}

// Approves consent and returns the redirect URL (redirect_uri?code=...&state=...)
// the browser should be sent to.
export default async function authorizeConsent(data: AuthorizeConsentInput): Promise<{ redirect_url: string }> {
    return await Request<{ redirect_url: string }>({
        method: "POST",
        url: `/oauth/authorize`,
        data,
        authorization: true,
    });
}
