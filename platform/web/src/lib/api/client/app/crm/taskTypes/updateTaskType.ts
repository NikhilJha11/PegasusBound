import type TaskType from "@/lib/api/models/app/crm/TaskType";
import Request from "../../../Request";

export default async function updateTaskType(
    id: string,
    data: { name?: string; color?: string; position?: number },
): Promise<TaskType> {
    return await Request<TaskType>({
        method: "PATCH",
        url: `/crm/task-types/${id}`,
        data,
        authorization: true,
    });
}
