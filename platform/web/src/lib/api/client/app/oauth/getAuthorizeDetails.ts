import Request from "../../Request";
import type { OAuthConsentInfo } from "@/lib/api/models/app/oauth/OAuthApp";

// Reads the consent details for the /oauth/authorize screen. `params` are the raw
// OAuth query parameters the third-party app redirected the browser with.
export default async function getAuthorizeDetails(params: Record<string, string>): Promise<OAuthConsentInfo> {
    const qs = new URLSearchParams(params).toString();
    return await Request<OAuthConsentInfo>({
        method: "GET",
        url: `/oauth/authorize/details?${qs}`,
        authorization: true,
    });
}
