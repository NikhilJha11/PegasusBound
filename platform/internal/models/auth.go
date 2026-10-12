package models

// ExternalAuthProviders is what GET /auth/providers advertises so one shipped
// native app binary can discover which social sign-in options a (self-)hosted
// backend supports. Client IDs here are public identifiers, not secrets.
//
// Browser social sign-in is separate and lives behind GET /auth/config: that
// flow runs server-side, so the dashboard needs the button list, not a client
// id.
type ExternalAuthProviders struct {
	AppleBundleID     string
	GoogleIOSClientID string
}
