import type TaskType from "@/lib/api/models/app/crm/TaskType";
import Request from "../../../Request";

export default async function listTaskTypes(): Promise<TaskType[]> {
    const res = await Request<{ data: TaskType[] } | TaskType[]>({
        method: "GET",
        url: "/crm/task-types",
        authorization: true,
    });
    if (Array.isArray(res)) return res;
    return res?.data ?? [];
}
