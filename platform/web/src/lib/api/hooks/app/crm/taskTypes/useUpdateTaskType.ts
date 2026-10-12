import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskType from "@/lib/api/client/app/crm/taskTypes/updateTaskType";

export default function useUpdateTaskType() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: { name?: string; color?: string; position?: number } }) =>
            updateTaskType(id, data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm", "task-types"] }),
    });
}
