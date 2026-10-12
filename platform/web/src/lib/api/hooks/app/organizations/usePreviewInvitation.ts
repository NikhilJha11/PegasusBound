import { useQuery } from "@tanstack/react-query";
import previewInvitation from "@/lib/api/client/app/organizations/previewInvitation";

export default function usePreviewInvitation(token: string | null) {
    return useQuery({
        queryKey: ["invitations", "preview", token],
        queryFn: () => previewInvitation(token as string),
        enabled: !!token,
        retry: false,
    })
}
