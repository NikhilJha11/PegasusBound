import { useMutation, useQueryClient } from "@tanstack/react-query";
import createTaskType from "@/lib/api/client/app/crm/taskTypes/createTaskType";

export default function useCreateTaskType() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { name: string; color?: string }) => createTaskType(data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "task-types"] }),
    });
}
