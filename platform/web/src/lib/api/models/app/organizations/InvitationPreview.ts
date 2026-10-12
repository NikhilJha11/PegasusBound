export default interface InvitationPreview {
    organization_name: string;
    organization_avatar?: string;
    inviter_name?: string;
    email: string;
    roles: { id: string; name: string; color: string }[];
    expired: boolean;
}
