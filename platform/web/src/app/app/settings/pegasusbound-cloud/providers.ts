// Which local mailboxes can be enrolled as they are. A Google or Microsoft
// grant issued by this instance's own OAuth app cannot be refreshed by the
// cloud; such mailboxes are instead signed in through Pegasusbound Cloud (managed).
export function providerSupported(provider: string): boolean {
    return provider === "smtp_imap";
}

export function providerLabel(provider: string): string {
    switch (provider) {
        case "gmail":
            return "Google";
        case "outlook":
            return "Microsoft";
        case "smtp_imap":
            return "SMTP/IMAP";
        default:
            return provider;
    }
}
