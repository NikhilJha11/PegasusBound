package poollink

import "testing"

func TestReturnURLStaysOnTheRegisteredInstance(t *testing.T) {
	const inst = "https://pegasusbound.acme.io"
	cases := []struct {
		instance, ret string
		want          bool
	}{
		{inst, "https://pegasusbound.acme.io/cloud-oauth/done", true},
		{inst, "https://PEGASUSBOUND.acme.io/cloud-oauth/done?x=1", true},
		{inst, "https://evil.example/cloud-oauth/done", false},
		{inst, "http://pegasusbound.acme.io/cloud-oauth/done", false},
		{inst, "https://pegasusbound.acme.io.evil.example/", false},
		{inst, "https://user@pegasusbound.acme.io/", false},
		{inst, "/cloud-oauth/done", false},
		{inst, "javascript:alert(1)", false},
		{"", "https://anything.example/", false},
		{"ftp://pegasusbound.acme.io", "ftp://pegasusbound.acme.io/", false},
	}
	for _, c := range cases {
		if got := returnURLAllowed(c.ret, c.instance); got != c.want {
			t.Errorf("returnURLAllowed(%q, %q) = %v, want %v", c.ret, c.instance, got, c.want)
		}
	}
}

func TestBrokerBindingMustMatch(t *testing.T) {
	if bindingMatches("", "") {
		t.Fatal("an unbound state matched a browser without the cookie")
	}
	if bindingMatches("abc", "abd") || bindingMatches("abc", "") {
		t.Fatal("a different browser matched")
	}
	if !bindingMatches("abc", "abc") {
		t.Fatal("the bound browser did not match")
	}
}
