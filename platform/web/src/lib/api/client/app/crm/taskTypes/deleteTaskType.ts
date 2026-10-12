import Request from "../../../Request";

export default async function deleteTaskType(id: string): Promise<void> {
    await Request<void>({
        method: "DELETE",
        url: `/crm/task-types/${id}`,
        authorization: true,
    });
}
