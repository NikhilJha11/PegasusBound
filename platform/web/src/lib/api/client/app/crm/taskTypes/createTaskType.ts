import type TaskType from "@/lib/api/models/app/crm/TaskType";
import Request from "../../../Request";

export default async function createTaskType(data: { name: string; color?: string }): Promise<TaskType> {
    return await Request<TaskType>({
        method: "POST",
        url: "/crm/task-types",
        data,
        authorization: true,
    });
}
