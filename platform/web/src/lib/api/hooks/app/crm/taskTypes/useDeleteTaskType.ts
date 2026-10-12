import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteTaskType from "@/lib/api/client/app/crm/taskTypes/deleteTaskType";

export default function useDeleteTaskType() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => deleteTaskType(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "task-types"] }),
    });
}
