package mailauth

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"testing"

	"golang.org/x/oauth2"
)

// retrieveErr builds the error x/oauth2 returns from a token endpoint that
// answered with status and this RFC 6749 body.
func retrieveErr(status int, code, description string) *oauth2.RetrieveError {
	return &oauth2.RetrieveError{
		Response:         &http.Response{StatusCode: status},
		Body:             []byte(fmt.Sprintf(`{"error":%q,"error_description":%q}`, code, description)),
		ErrorCode:        code,
		ErrorDescription: description,
	}
}

func TestClassifyTokenError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want TokenVerdict
	}{
		{"nil error", nil, TokenNotRefused},
		{"plain transport failure", errors.New("dial tcp: i/o timeout"), TokenNotRefused},
		{
			// The shape the mail clients actually see: http.Client wraps
			// whatever the oauth2 transport returned in a *url.Error.
			"revoked refresh token through url.Error",
			&url.Error{Op: "Get", URL: "https://graph.microsoft.com/v1.0/me/messages", Err: retrieveErr(400, "invalid_grant", "AADSTS50173: token revoked")},
			TokenRevoked,
		},
		{"revoked refresh token", retrieveErr(400, "invalid_grant", "expired"), TokenRevoked},
		{"consent withdrawn", retrieveErr(400, "consent_required", "admin consent revoked"), TokenRevoked},
		{"policy now needs the user", retrieveErr(400, "interaction_required", "MFA required"), TokenRevoked},
		{"session gone", retrieveErr(400, "login_required", "user must sign in"), TokenRevoked},

		// The regression this classification exists to avoid: everything below
		// is the provider having a moment, not a mailbox that needs its owner.
		{"token endpoint throttling", retrieveErr(http.StatusTooManyRequests, "", ""), TokenRefusedNow},
		{"token endpoint throttling with a code", retrieveErr(http.StatusTooManyRequests, "temporarily_unavailable", "slow down"), TokenRefusedNow},
		{"token endpoint 500", retrieveErr(500, "", ""), TokenRefusedNow},
		{"token endpoint 503", retrieveErr(503, "temporarily_unavailable", "try later"), TokenRefusedNow},
		{"provider server_error", retrieveErr(400, "server_error", "transient"), TokenRefusedNow},
		{"unrecognised code", retrieveErr(400, "something_new", "who knows"), TokenRefusedNow},
		{"no code at all", retrieveErr(400, "", ""), TokenRefusedNow},

		// An expired app secret answers this for every mailbox on the install
		// at once, so it must never disconnect any of them.
		{"our app credentials are wrong", retrieveErr(401, "invalid_client", "secret expired"), TokenRefusedNow},
		{"our app is not allowed", retrieveErr(400, "unauthorized_client", "app blocked"), TokenRefusedNow},

		// Some endpoints answer 200 with an error body; x/oauth2 still reports
		// a RetrieveError, and the code is the only signal.
		{"200 carrying an error code", retrieveErr(200, "invalid_grant", "revoked"), TokenRevoked},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyTokenError(tt.err).Verdict; got != tt.want {
				t.Errorf("verdict = %v, want %v", got, tt.want)
			}
		})
	}
}

// A RetrieveError can arrive with no Response at all; reading the status off it
// must not panic.
func TestClassifyTokenErrorWithoutAResponse(t *testing.T) {
	f := ClassifyTokenError(&oauth2.RetrieveError{ErrorCode: "invalid_grant"})
	if !f.Revoked() {
		t.Errorf("verdict = %v, want TokenRevoked", f.Verdict)
	}
	if f.Status != 0 {
		t.Errorf("status = %d, want 0", f.Status)
	}
}

// The provider's own words are what an operator needs to see next to a
// mailbox that was just disconnected.
func TestClassifyTokenErrorCarriesTheProvidersWords(t *testing.T) {
	f := ClassifyTokenError(retrieveErr(400, "invalid_grant", "AADSTS50173: password changed"))
	if !f.Refused() || !f.Revoked() {
		t.Fatalf("refused=%v revoked=%v, want both true", f.Refused(), f.Revoked())
	}
	if f.ErrorCode != "invalid_grant" || f.Description != "AADSTS50173: password changed" || f.Status != 400 {
		t.Errorf("got code=%q description=%q status=%d", f.ErrorCode, f.Description, f.Status)
	}
}

func TestRefusedIsFalseForANonTokenFailure(t *testing.T) {
	if ClassifyTokenError(errors.New("connection reset")).Refused() {
		t.Error("a transport failure was reported as a token refusal")
	}
}
