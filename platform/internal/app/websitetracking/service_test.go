package websitetracking

import "testing"

func TestHostAllowedCoversSubdomainsAndIgnoresPorts(t *testing.T) {
	allowed := []string{"example.com", "shop.other.io"}
	for host, want := range map[string]bool{
		"example.com":          true,
		"www.example.com":      true,
		"app.example.com:8443": true,
		"EXAMPLE.COM":          true,
		"notexample.com":       false,
		"example.com.evil.net": false,
		"other.io":             false,
		"shop.other.io":        true,
		"":                     false,
	} {
		if got := hostAllowed(allowed, host); got != want {
			t.Errorf("hostAllowed(%q) = %v, want %v", host, got, want)
		}
	}
}

func TestNormalizeHostsReducesPastedURLs(t *testing.T) {
	hosts, ok := normalizeHosts([]string{" https://WWW.Example.com/path ", "www.example.com", "", "app.example.com."})
	if !ok {
		t.Fatal("expected hosts to normalize")
	}
	if len(hosts) != 2 || hosts[0] != "www.example.com" || hosts[1] != "app.example.com" {
		t.Fatalf("unexpected hosts: %v", hosts)
	}
	if _, ok := normalizeHosts(make([]string, 0)); !ok {
		t.Fatal("empty list must be allowed")
	}
	many := make([]string, maxHosts+1)
	for i := range many {
		many[i] = "h" + string(rune('a'+i)) + ".example.com"
	}
	if _, ok := normalizeHosts(many); ok {
		t.Fatal("expected the host cap to refuse")
	}
}

func TestValidKeyShape(t *testing.T) {
	if !validKey("0123456789abcdef0123456789abcdef") {
		t.Fatal("hex key must pass")
	}
	for _, bad := range []string{"short", "has space in the key!!", ""} {
		if validKey(bad) {
			t.Errorf("validKey(%q) should fail", bad)
		}
	}
}
