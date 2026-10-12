import Request from "../../Request";
import type { OAuthApplicationsResult } from "@/lib/api/models/app/oauth/OAuthApp";

export default async function listOAuthApps(): Promise<OAuthApplicationsResult> {
    return await Request<OAuthApplicationsResult>({
        method: "GET",
        url: `/oauth/applications`,
        authorization: true,
    });
}
