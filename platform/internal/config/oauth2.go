package config

// Oauth2 is the mailbox-connect OAuth configuration. Sign-in clients are not
// here: browser social sign-in builds its own config in internal/app/socialauth,
// where the ID token is verified rather than a userinfo endpoint called.
type Oauth2 struct {
	InboxAuthorization Oauth2Inbox
}

func LoadOauth2(baseURL string) *Oauth2 {
	return &Oauth2{
		InboxAuthorization: LoadOauth2Inbox(baseURL),
	}
}

func LoadOauth2Inbox(baseURL string) Oauth2Inbox {
	return Oauth2Inbox{
		Google:  GoogleOauth2Inbox(baseURL),
		Outlook: OutlookOauth2Inbox(baseURL),
	}
}
