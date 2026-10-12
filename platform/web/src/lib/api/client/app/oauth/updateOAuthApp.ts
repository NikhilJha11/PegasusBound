import Request from "../../Request";
import type { OAuthApplication, OAuthApplicationInput } from "@/lib/api/models/app/oauth/OAuthApp";

export default async function updateOAuthApp(id: string, data: OAuthApplicationInput): Promise<OAuthApplication> {
    return await Request<OAuthApplication>({
        method: "PATCH",
        url: `/oauth/applications/${id}`,
        data,
        authorization: true,
    });
}
