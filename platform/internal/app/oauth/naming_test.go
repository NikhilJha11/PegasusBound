package oauth

import "testing"

func TestAppNameFollowsTheNamingRules(t *testing.T) {
	if got, err := appName("  Acme   Sync ", ""); err != nil || got != "Acme Sync" {
		t.Fatalf("appName = %q, %v", got, err)
	}
	for _, bad := range []string{"", "Verify at evil.example", "https://acme.com", "Acme ‮ppa", "<b>Acme</b>"} {
		if _, err := appName(bad, ""); err == nil {
			t.Errorf("appName(%q) accepted", bad)
		}
	}
}

func TestAppWebsite(t *testing.T) {
	for _, ok := range []string{"", "https://acme.com", "http://acme.com/path"} {
		if _, err := appWebsite(ok); err != nil {
			t.Errorf("appWebsite(%q) refused: %v", ok, err)
		}
	}
	for _, bad := range []string{"javascript:alert(1)", "data:text/html,x", "acme.com", "https://user:pw@acme.com", "ftp://acme.com"} {
		if _, err := appWebsite(bad); err == nil {
			t.Errorf("appWebsite(%q) accepted", bad)
		}
	}
}

func TestAppNameRefusesThePlatformName(t *testing.T) {
	for _, bad := range []string{"Pegasusbound", "Pegasusbound Support", "HubSpot for pegasusbound", "P e g a s u s b o u n d", "Pegasus-bound", "Pegasusb0und", "Pеgasusbound", "Рegasusbound", "Pegа5usbound", "Ｐｅｇａｓｕｓｂｏｕｎｄ"} {
		if _, err := appName(bad, ""); err == nil {
			t.Errorf("appName(%q) accepted", bad)
		}
	}
	for _, ok := range []string{"Acme Sync", "Pegasus Labs", "Bound Leads"} {
		if _, err := appName(ok, ""); err != nil {
			t.Errorf("appName(%q) refused: %v", ok, err)
		}
	}
	if _, err := appName("Pegasusbound Sync", "Pegasusbound Sync"); err != nil {
		t.Errorf("an unchanged existing name was refused: %v", err)
	}
	if _, err := appName("Pegasusbound Sync 2", "Pegasusbound Sync"); err == nil {
		t.Error("a changed name naming the platform was accepted")
	}
}

func TestDCRClientNameDropsThePlatformName(t *testing.T) {
	cases := map[string]string{
		"Claude Code (pegasusbound)":   "Claude Code",
		"Cursor [Pegasusbound prod]":   "Cursor",
		"Cursor":                       "Cursor",
		"Claude Code (work)":           "Claude Code (work)",
		"Pegasusbound Support":         dcrFallbackName,
		"Pegasusbound (Claude Code)":   dcrFallbackName,
		"":                             dcrFallbackName,
		"https://pegasusbound.example": dcrFallbackName,
	}
	for in, want := range cases {
		if got := dcrClientName(in); got != want {
			t.Errorf("dcrClientName(%q) = %q, want %q", in, got, want)
		}
	}
	if got := ImportedName("Pegasusbound Sync"); got != "Imported app" {
		t.Errorf("ImportedName kept the platform name: %q", got)
	}
}
