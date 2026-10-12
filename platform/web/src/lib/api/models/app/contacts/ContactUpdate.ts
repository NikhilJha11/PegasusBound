import type Contact from "./Contact";

export default interface ContactUpdate extends Omit<Contact, "campaigns" | "categories"> {
    campaigns: string[],
    categories: string[],
}
