import Request from "../../Request";

export default async function revokeAuthorizedApp(applicationId: string): Promise<{ revoked: boolean }> {
    return await Request<{ revoked: boolean }>({
        method: "DELETE",
        url: `/oauth/authorized-apps/${applicationId}`,
        authorization: true,
    });
}
