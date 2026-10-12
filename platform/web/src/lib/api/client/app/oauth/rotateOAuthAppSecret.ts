import Request from "../../Request";

export default async function rotateOAuthAppSecret(id: string): Promise<{ client_secret: string }> {
    return await Request<{ client_secret: string }>({
        method: "POST",
        url: `/oauth/applications/${id}/rotate-secret`,
        authorization: true,
    });
}
