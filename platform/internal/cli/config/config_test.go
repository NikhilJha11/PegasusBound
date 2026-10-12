package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeHost(t *testing.T) {
	cases := map[string]string{
		"pegasusbound.com":             "pegasusbound.com",
		"PEGASUSBOUND.COM":             "pegasusbound.com",
		"https://app.pegasusbound.com": "pegasusbound.com",
		"api.pegasusbound.com":         "pegasusbound.com",
		"https://api.acme.dev/":        "acme.dev",
		"pegasusbound.acme.com":        "pegasusbound.acme.com",
		"localhost:8080":               "localhost:8080",
		"":                             DefaultHost,
		// A two-label host is not a subdomain of anything, so "api.dev" must
		// not be stripped down to "dev".
		"api.dev": "api.dev",
	}
	for in, want := range cases {
		if got := NormalizeHost(in); got != want {
			t.Errorf("NormalizeHost(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDefaultAPIURL(t *testing.T) {
	cases := map[string]string{
		"pegasusbound.com":      "https://api.pegasusbound.com",
		"pegasusbound.acme.com": "https://api.pegasusbound.acme.com",
		"localhost:8080":        "http://localhost:8080",
	}
	for in, want := range cases {
		if got := DefaultAPIURL(in); got != want {
			t.Errorf("DefaultAPIURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCandidateAPIURLs(t *testing.T) {
	got := CandidateAPIURLs("acme.dev")
	want := []string{"https://api.acme.dev", "https://acme.dev", "https://acme.dev/api"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
	// A host with a port is an exact address; inventing api.<host>:port would
	// probe something that cannot exist.
	if urls := CandidateAPIURLs("localhost:8080"); len(urls) != 1 || urls[0] != "http://localhost:8080" {
		t.Errorf("port host candidates = %v", urls)
	}
}

func TestResolvePrefersEnvironmentAndSaysSo(t *testing.T) {
	t.Setenv(TokenEnv, "pgsbd_from_env")
	hosts := Hosts{"pegasusbound.com": {APIURL: "https://api.pegasusbound.com", Token: "pgsbd_from_file"}}
	r, err := Resolve(&Config{ActiveHost: "pegasusbound.com"}, hosts, "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if r.Token != "pgsbd_from_env" {
		t.Errorf("token = %q, want the environment's", r.Token)
	}
	if r.Source != TokenEnv {
		t.Errorf("source = %q, want %q so a surprising result is traceable", r.Source, TokenEnv)
	}
}

func TestResolveWithNoCredential(t *testing.T) {
	t.Setenv(TokenEnv, "")
	t.Setenv(APIKeyEnv, "")
	_, err := Resolve(&Config{}, Hosts{}, "")
	var missing *ErrNoToken
	if err == nil {
		t.Fatal("expected an error when nothing is signed in")
	}
	if !asErrNoToken(err, &missing) {
		t.Fatalf("got %T, want *ErrNoToken", err)
	}
}

func asErrNoToken(err error, target **ErrNoToken) bool {
	e, ok := err.(*ErrNoToken)
	if ok {
		*target = e
	}
	return ok
}

func TestResolveUsesTheOnlyHostWhenNoneIsActive(t *testing.T) {
	t.Setenv(TokenEnv, "")
	t.Setenv(APIKeyEnv, "")
	hosts := Hosts{"pegasusbound.acme.com": {APIURL: "https://api.pegasusbound.acme.com", Token: "pgsbd_x"}}
	r, err := Resolve(&Config{}, hosts, "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if r.Host != "pegasusbound.acme.com" {
		t.Errorf("host = %q, want the only signed-in one", r.Host)
	}
}

// The credential file must never be group or world readable.
func TestHostsSaveIsPrivate(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(DirEnv, dir)

	hosts := Hosts{"pegasusbound.com": {APIURL: "https://api.pegasusbound.com", Token: "pgsbd_secret"}}
	if err := hosts.Save(); err != nil {
		t.Fatalf("save: %v", err)
	}
	info, err := os.Stat(filepath.Join(dir, "hosts.yml"))
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("hosts.yml is %o, want 600", perm)
	}

	loaded, err := LoadHosts()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded["pegasusbound.com"].Token != "pgsbd_secret" {
		t.Errorf("round trip lost the token")
	}

	// Signing out of the last host leaves no file behind.
	delete(loaded, "pegasusbound.com")
	if err := loaded.Save(); err != nil {
		t.Fatalf("save empty: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "hosts.yml")); !os.IsNotExist(err) {
		t.Errorf("hosts.yml survived an empty save")
	}
}

func TestConfigSetRejectsUnknownAndInvalid(t *testing.T) {
	c := &Config{}
	if err := c.Set("nonsense", "x"); err == nil {
		t.Error("an unknown key must be rejected, not silently stored")
	}
	if err := c.Set("output", "yaml"); err == nil {
		t.Error("an invalid output format must be rejected at set time")
	}
	if err := c.Set("output", "json"); err != nil {
		t.Errorf("valid value rejected: %v", err)
	}
	if c.Get("confirm") != "sends" {
		t.Errorf("confirm default = %q, want sends", c.Get("confirm"))
	}
}

// Every request carries a bearer token, so only this machine may be reached
// over plaintext HTTP. A remote host that merely names a port must not be
// downgraded, and the two URL helpers must not disagree about it.
func TestRemoteHostWithAPortStaysHTTPS(t *testing.T) {
	if got := DefaultAPIURL("acme.dev:8443"); got != "https://acme.dev:8443" {
		t.Errorf("DefaultAPIURL = %q, want https", got)
	}
	if urls := CandidateAPIURLs("acme.dev:8443"); len(urls) != 1 || urls[0] != "https://acme.dev:8443" {
		t.Errorf("CandidateAPIURLs = %v, want one https entry", urls)
	}
	for _, local := range []string{"localhost:8080", "127.0.0.1:8080", "localhost"} {
		if got := DefaultAPIURL(local); got[:5] != "http:" {
			t.Errorf("DefaultAPIURL(%q) = %q, want plaintext for the local machine", local, got)
		}
	}
	// A host that merely starts with "localhost" is somebody else's domain.
	if got := DefaultAPIURL("localhost.evil.example"); got[:6] != "https:" {
		t.Errorf("DefaultAPIURL(localhost.evil.example) = %q, want https", got)
	}
}
