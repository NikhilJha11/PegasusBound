// Package mailauth classifies OAuth2 token-exchange failures for the mail
// clients.
//
// A client built on oauth2.NewClient runs its token source inside the HTTP
// call, so a refresh the provider refuses surfaces as a failure of the call
// itself rather than as a status code. Both naive readings of that error are
// wrong in a way that costs someone real mail: calling every refusal a
// transport failure promises a retry that can never succeed, and calling every
// refusal a dead grant disconnects a working mailbox over a throttle the
// provider would have cleared in seconds.
package mailauth

import (
	"errors"
	"net/http"

	"golang.org/x/oauth2"
)

// TokenVerdict is what a failed HTTP call says about the grant behind it.
type TokenVerdict int

const (
	// TokenNotRefused means the failure did not come from the token endpoint
	// (DNS, TLS, timeout, a refusal shape we cannot read).
	TokenNotRefused TokenVerdict = iota
	// TokenRefusedNow means the provider declined to mint a token this time.
	// Retrying is the right response.
	TokenRefusedNow
	// TokenRevoked means the grant itself is dead: retrying cannot fix it and
	// only the mailbox owner re-consenting will.
	TokenRevoked
)

// revokedGrantCodes are the RFC 6749 / OIDC error codes that mean THIS grant
// is finished: revoked or expired refresh token, a password change, or a
// policy that now demands the user in person.
//
// Codes about the application rather than the grant (invalid_client,
// unauthorized_client) are deliberately absent. An expired app secret returns
// those for every mailbox at once, and answering an operator's rotation
// mistake by disconnecting every customer's mailbox (into a re-consent that
// cannot work either, because the app is the broken part) is far worse than
// retrying until the secret is rotated.
var revokedGrantCodes = map[string]bool{
	"invalid_grant":        true,
	"interaction_required": true,
	"consent_required":     true,
	"login_required":       true,
}

// TokenFailure is a classified token-endpoint refusal, carrying the provider's
// own words so the caller can log why a mailbox was disconnected.
type TokenFailure struct {
	Verdict TokenVerdict
	// ErrorCode and Description are RFC 6749 5.2 'error' and
	// 'error_description'. Empty when the endpoint sent neither.
	ErrorCode   string
	Description string
	// Status is the token endpoint's HTTP status, 0 when there was no response.
	Status int
}

// Refused reports whether the token endpoint is what failed.
func (f TokenFailure) Refused() bool { return f.Verdict != TokenNotRefused }

// Revoked reports whether the grant is finished and only re-consent restores it.
func (f TokenFailure) Revoked() bool { return f.Verdict == TokenRevoked }

// ClassifyTokenError inspects err and anything it wraps for a token endpoint
// refusal. Anything it cannot positively read as a dead grant is transient:
// the cost of retrying a mailbox that is really finished is log noise, and the
// cost of the opposite mistake is a working mailbox disconnected until its
// owner notices.
func ClassifyTokenError(err error) TokenFailure {
	var retrieve *oauth2.RetrieveError
	if !errors.As(err, &retrieve) {
		return TokenFailure{Verdict: TokenNotRefused}
	}

	f := TokenFailure{
		Verdict:     TokenRefusedNow,
		ErrorCode:   retrieve.ErrorCode,
		Description: retrieve.ErrorDescription,
	}
	if retrieve.Response != nil {
		f.Status = retrieve.Response.StatusCode
	}

	// The provider is rate limiting or broken: it is not saying anything about
	// the grant, whatever error code rides along.
	if f.Status == http.StatusTooManyRequests || f.Status >= 500 {
		return f
	}
	if revokedGrantCodes[f.ErrorCode] {
		f.Verdict = TokenRevoked
	}
	return f
}
