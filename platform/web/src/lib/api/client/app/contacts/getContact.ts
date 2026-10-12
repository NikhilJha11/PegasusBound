import type ContactDetail from "@/lib/api/models/app/contacts/ContactDetail";
import Request from "../../Request";

export default async function getContact(id: string): Promise<ContactDetail> {
    return await Request<ContactDetail>({
        method: "GET",
        url: `/contacts/${id}`,
        authorization: true,
    });
}
