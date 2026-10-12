import Request from "../../Request";

export default async function getInvitationLink(invitationId: string): Promise<{ token: string }> {
    return await Request<{ token: string }>({
        method: "GET",
        url: `/organization/invitations/${invitationId}/link`,
        authorization: true,
    })
}
