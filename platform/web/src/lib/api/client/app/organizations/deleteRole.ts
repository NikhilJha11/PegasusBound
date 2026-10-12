import Request from "../../Request";

export default async function deleteRole(id: string): Promise<void> {
    await Request<void>({
        method: "DELETE",
        url: `/organization/roles/${id}`,
        authorization: true,
    })
}
