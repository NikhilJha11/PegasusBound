import Request from "../../Request";
import type { OAuthApplicationInput, OAuthApplicationWithSecret } from "@/lib/api/models/app/oauth/OAuthApp";

export default async function createOAuthApp(data: OAuthApplicationInput): Promise<OAuthApplicationWithSecret> {
    return await Request<OAuthApplicationWithSecret>({
        method: "POST",
        url: `/oauth/applications`,
        data,
        authorization: true,
    });
}
