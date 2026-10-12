package trackdns

import (
	"context"
	"net"
	"strings"
	"testing"
)

// fakeResolver answers from fixed tables. A name absent from both is NXDOMAIN,
// matching what a real resolver reports for a name that does not exist.
type fakeResolver struct {
	cnames map[string]string
	ips    map[string][]string
	fail   map[string]bool // transient failure (SERVFAIL/timeout), not NXDOMAIN
}

func (f fakeResolver) LookupCNAME(_ context.Context, host string) (string, error) {
	host = strings.TrimSuffix(host, ".")
	if f.fail[host] {
		return "", &net.DNSError{Err: "server misbehaving", Name: host, IsTemporary: true}
	}
	if c, ok := f.cnames[host]; ok {
		return c + ".", nil
	}
	if _, ok := f.ips[host]; ok {
		// No CNAME in the chain: the resolver echoes the queried name back.
		return host + ".", nil
	}
	return "", &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
}

func (f fakeResolver) LookupIPAddr(_ context.Context, host string) ([]net.IPAddr, error) {
	host = strings.TrimSuffix(host, ".")
	if f.fail[host] {
		return nil, &net.DNSError{Err: "server misbehaving", Name: host, IsTemporary: true}
	}
	// Follow one CNAME hop the way a real resolver does.
	if c, ok := f.cnames[host]; ok {
		host = c
	}
	addrs, ok := f.ips[host]
	if !ok {
		return nil, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
	}
	out := make([]net.IPAddr, 0, len(addrs))
	for _, a := range addrs {
		out = append(out, net.IPAddr{IP: net.ParseIP(a)})
	}
	return out, nil
}

const target = "t.pegasusbound.com"

func healthyTarget() fakeResolver {
	return fakeResolver{
		cnames: map[string]string{},
		ips:    map[string][]string{target: {"203.0.113.10"}},
		fail:   map[string]bool{},
	}
}

func TestVerifyCNAMEPointsAtTarget(t *testing.T) {
	r := healthyTarget()
	r.cnames["track.acme.com"] = target

	res := VerifyWith(context.Background(), r, "track.acme.com", target)
	if !res.Verified || res.Code != CodeVerified || res.Method != MethodCNAME {
		t.Fatalf("expected cname verification, got %+v", res)
	}
	if res.TargetUnresolvable {
		t.Fatalf("tracking host resolves; got TargetUnresolvable: %+v", res)
	}
}

func TestVerifyAcceptsTrailingDotAndCase(t *testing.T) {
	r := healthyTarget()
	r.cnames["track.acme.com"] = target

	res := VerifyWith(context.Background(), r, "  TRACK.Acme.com.  ", "T.Pegasusbound.COM.")
	if !res.Verified {
		t.Fatalf("normalization should not change the verdict: %+v", res)
	}
	if res.Domain != "track.acme.com" || res.Target != target {
		t.Fatalf("expected normalized names, got %q / %q", res.Domain, res.Target)
	}
}

func TestVerifySubdomainOfTargetCounts(t *testing.T) {
	r := healthyTarget()
	r.cnames["track.acme.com"] = "edge-1." + target
	r.ips["edge-1."+target] = []string{"203.0.113.11"}

	res := VerifyWith(context.Background(), r, "track.acme.com", target)
	if !res.Verified {
		t.Fatalf("a name under the tracking host is still the tracking host: %+v", res)
	}
}

// The old check used strings.Contains, so a name that merely contained the
// tracking host verified and every tracked link went to the attacker.
func TestVerifyRejectsLookalikeSuffix(t *testing.T) {
	r := healthyTarget()
	r.cnames["track.acme.com"] = target + ".attacker.net"
	r.ips[target+".attacker.net"] = []string{"198.51.100.7"}

	res := VerifyWith(context.Background(), r, "track.acme.com", target)
	if res.Verified {
		t.Fatalf("lookalike suffix must not verify: %+v", res)
	}
	if res.Code != CodeWrongTarget {
		t.Fatalf("expected wrong_target, got %q", res.Code)
	}
}

// A provider that flattens the CNAME (ALIAS records, apex flattening, proxied
// records) answers with address records only. That is a working setup and used
// to sit at "Pending DNS" forever.
func TestVerifyFlattenedRecordMatchesOnAddress(t *testing.T) {
	r := healthyTarget()
	r.ips["track.acme.com"] = []string{"203.0.113.10"}

	res := VerifyWith(context.Background(), r, "track.acme.com", target)
	if !res.Verified || res.Method != MethodAddress {
		t.Fatalf("expected address verification, got %+v", res)
	}
}

func TestVerifyUnrelatedAddressesDoNotMatch(t *testing.T) {
	r := healthyTarget()
	r.ips["track.acme.com"] = []string{"198.51.100.7"}

	res := VerifyWith(context.Background(), r, "track.acme.com", target)
	if res.Verified || res.Code != CodeWrongTarget {
		t.Fatalf("expected wrong_target, got %+v", res)
	}
}

func TestVerifyMissingRecordIsNotFound(t *testing.T) {
	res := VerifyWith(context.Background(), healthyTarget(), "xyz.tracking.com", target)
	if res.Verified || res.Code != CodeNotFound {
		t.Fatalf("expected not_found, got %+v", res)
	}
	if !strings.Contains(res.Reason, "xyz.tracking.com") {
		t.Fatalf("the reason has to name the domain: %q", res.Reason)
	}
}

func TestVerifyWrongTargetNamesWhatItFound(t *testing.T) {
	r := healthyTarget()
	r.cnames["track.acme.com"] = "tracking.otherprovider.com"
	r.ips["tracking.otherprovider.com"] = []string{"198.51.100.9"}

	res := VerifyWith(context.Background(), r, "track.acme.com", target)
	if res.Verified || res.Code != CodeWrongTarget {
		t.Fatalf("expected wrong_target, got %+v", res)
	}
	if res.Observed != "tracking.otherprovider.com" {
		t.Fatalf("expected the observed target, got %q", res.Observed)
	}
}

// The record is right but the tracking host does not exist. The customer stays
// verified (the shared host they would fall back to is the same dead host) and
// the reason points at the install.
func TestVerifyDanglingTargetStaysVerifiedAndSaysSo(t *testing.T) {
	r := fakeResolver{cnames: map[string]string{"track.acme.com": target}, ips: map[string][]string{}, fail: map[string]bool{}}

	res := VerifyWith(context.Background(), r, "track.acme.com", target)
	if !res.Verified {
		t.Fatalf("the customer's record is correct: %+v", res)
	}
	if !res.TargetUnresolvable {
		t.Fatalf("expected TargetUnresolvable: %+v", res)
	}
	if !strings.Contains(res.Reason, "administrator") {
		t.Fatalf("the reason has to point at the operator: %q", res.Reason)
	}
}

func TestVerifyTransientFailureIsNotAMisconfiguration(t *testing.T) {
	r := healthyTarget()
	r.fail["track.acme.com"] = true

	res := VerifyWith(context.Background(), r, "track.acme.com", target)
	if res.Verified || res.Code != CodeLookupError {
		t.Fatalf("expected lookup_error, got %+v", res)
	}
}

func TestVerifyNoTargetConfigured(t *testing.T) {
	res := VerifyWith(context.Background(), healthyTarget(), "track.acme.com", "")
	if res.Verified || res.Code != CodeNoTarget {
		t.Fatalf("expected no_target, got %+v", res)
	}
	if !strings.Contains(res.Reason, "TRACKING_DOMAIN") {
		t.Fatalf("the operator has to be told what to set: %q", res.Reason)
	}
}

func TestVerifyEmptyDomainIsUnset(t *testing.T) {
	res := VerifyWith(context.Background(), healthyTarget(), "", target)
	if res.Verified || res.Code != CodeUnset {
		t.Fatalf("expected unset, got %+v", res)
	}
}

func TestVerifySharedHostItself(t *testing.T) {
	res := VerifyWith(context.Background(), healthyTarget(), target, target)
	if !res.Verified {
		t.Fatalf("the shared host is trivially in place: %+v", res)
	}
}

// A port on either side is not part of DNS. Development runs on
// localhost:3000, and a customer pasting host:port must not silently fail.
func TestVerifyIgnoresPorts(t *testing.T) {
	r := healthyTarget()
	r.cnames["track.acme.com"] = target

	res := VerifyWith(context.Background(), r, "track.acme.com:443", target+":3000")
	if !res.Verified {
		t.Fatalf("ports must not affect the lookup: %+v", res)
	}
}

// Telling somebody to point a CNAME at a host that does not exist is the
// hosted shape of issue #173, so the note has to appear whether or not their
// own record is right yet.
func TestVerifyDanglingTargetIsNotedWhenNotVerifiedEither(t *testing.T) {
	r := fakeResolver{
		cnames: map[string]string{"track.acme.com": "somewhere.else.com"},
		ips:    map[string][]string{"somewhere.else.com": {"198.51.100.7"}},
		fail:   map[string]bool{},
	}

	res := VerifyWith(context.Background(), r, "track.acme.com", target)
	if res.Verified || res.Code != CodeWrongTarget {
		t.Fatalf("expected wrong_target, got %+v", res)
	}
	if !res.TargetUnresolvable || !strings.Contains(res.Reason, "administrator") {
		t.Fatalf("the operator's half of the problem has to be reported too: %+v", res)
	}
}
