package emailverify

import "testing"

func TestNormalizeExternalReadsEveryKnownVocabulary(t *testing.T) {
	cases := []struct {
		provider, raw string
		want          Status
		sub           SubStatus
	}{
		{"zerobounce", "valid", StatusValid, SubStatusNone},
		{"zerobounce", "catch-all", StatusRisky, SubStatusCatchAll},
		{"zerobounce", "spamtrap", StatusInvalid, SubStatusSpamTrap},
		{"millionverifier", "ok", StatusValid, SubStatusNone},
		{"millionverifier", "catch_all", StatusRisky, SubStatusCatchAll},
		{"millionverifier", "disposable", StatusInvalid, SubStatusDisposable},
		{"neverbounce", "catchall", StatusRisky, SubStatusCatchAll},
		{"bouncer", "deliverable", StatusValid, SubStatusNone},
		{"kickbox", "accept-all", StatusRisky, SubStatusCatchAll},
		{"emaillistverify", "ok_for_all", StatusRisky, SubStatusCatchAll},
		{"", "Safe to Send", StatusValid, SubStatusNone},
		{"", "INVALID", StatusInvalid, SubStatusNone},
		{"", "unknown", StatusUnknown, SubStatusNone},
	}
	for _, c := range cases {
		got, ok := NormalizeExternal(c.provider, c.raw)
		if !ok {
			t.Fatalf("%s/%q not recognised", c.provider, c.raw)
		}
		if got.Status != c.want || got.SubStatus != c.sub {
			t.Fatalf("%s/%q = %v/%v, want %v/%v", c.provider, c.raw, got.Status, got.SubStatus, c.want, c.sub)
		}
	}
	if _, ok := NormalizeExternal("", "qualified lead"); ok {
		t.Fatal("a CRM stage must not read as a verdict")
	}
	if _, ok := NormalizeExternal("nosuchprovider", "valid"); ok {
		t.Fatal("an unknown provider must not be read")
	}
}

func TestDetectVocabularyNamesTheProviderOrRefuses(t *testing.T) {
	if p, ok := DetectVocabulary([]string{"valid", "catch-all", "", "do_not_mail"}); !ok || p != "zerobounce" {
		t.Fatalf("zerobounce column = %q/%v", p, ok)
	}
	if p, ok := DetectVocabulary([]string{"ok", "catch_all", "unknown"}); !ok || p != ProviderMillionVerifier {
		t.Fatalf("millionverifier column = %q/%v", p, ok)
	}
	if _, ok := DetectVocabulary([]string{"valid", "won", "lost"}); ok {
		t.Fatal("mixed column must not be a verdict column")
	}
	if _, ok := DetectVocabulary([]string{"", ""}); ok {
		t.Fatal("blank column must not be a verdict column")
	}
}

func TestIsStatusHeader(t *testing.T) {
	if p, ok := IsStatusHeader("ZeroBounce Status"); !ok || p != "zerobounce" {
		t.Fatalf("header = %q/%v", p, ok)
	}
	if p, ok := IsStatusHeader("verification_status"); !ok || p != "" {
		t.Fatalf("generic header = %q/%v", p, ok)
	}
	if _, ok := IsStatusHeader("Deal stage"); ok {
		t.Fatal("deal stage is not a status header")
	}
}

func TestFingerprintMXNamesUndisclosingProviders(t *testing.T) {
	if fp := fingerprintMX([]string{"acme-com.mail.protection.outlook.com"}); !fp.undisclosed || fp.name != "Microsoft 365" {
		t.Fatalf("m365 = %+v", fp)
	}
	if fp := fingerprintMX([]string{"aspmx.l.google.com"}); fp.undisclosed {
		t.Fatalf("google must be probed: %+v", fp)
	}
}

func TestDomainCacheExpires(t *testing.T) {
	c := newDomainCache(0)
	c.put("a.com", domainFact{kind: domainCatchAll})
	if _, ok := c.get("a.com"); ok {
		t.Fatal("zero ttl entry must be expired")
	}
}
