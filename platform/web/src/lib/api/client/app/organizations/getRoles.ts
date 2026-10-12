import type OrganizationRole from "@/lib/api/models/app/organizations/OrganizationRole";
import Request from "../../Request";

export default async function getRoles(): Promise<{ data: OrganizationRole[] }> {
    return await Request<{ data: OrganizationRole[] }>({
        method: "GET",
        url: `/organization/roles`,
        authorization: true,
    })
}
