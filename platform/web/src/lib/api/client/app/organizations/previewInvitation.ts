import type InvitationPreview from "@/lib/api/models/app/organizations/InvitationPreview";
import Request from "../../Request";

export default async function previewInvitation(token: string): Promise<InvitationPreview> {
    return await Request<InvitationPreview>({
        method: "GET",
        url: `/invitations/lookup`,
        params: { token },
        authorization: false,
    })
}
