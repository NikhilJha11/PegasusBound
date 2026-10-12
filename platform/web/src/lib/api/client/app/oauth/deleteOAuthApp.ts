import Request from "../../Request";

export default async function deleteOAuthApp(id: string): Promise<{ deleted: boolean }> {
    return await Request<{ deleted: boolean }>({
        method: "DELETE",
        url: `/oauth/applications/${id}`,
        authorization: true,
    });
}
