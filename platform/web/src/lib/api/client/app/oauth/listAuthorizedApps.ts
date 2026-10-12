import Request from "../../Request";
import type { OAuthAuthorizedAppsResult } from "@/lib/api/models/app/oauth/OAuthApp";

export default async function listAuthorizedApps(): Promise<OAuthAuthorizedAppsResult> {
    return await Request<OAuthAuthorizedAppsResult>({
        method: "GET",
        url: `/oauth/authorized-apps`,
        authorization: true,
    });
}
