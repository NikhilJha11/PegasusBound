// Package trackdns verifies that a customer's own tracking subdomain points at
// this install's tracking host, and says why when it does not.
//
// The check used to be one CNAME lookup against a hardcoded host with a
// strings.Contains compare, and every failure rendered as a mute "Pending DNS"
// badge. That is unresolvable from the customer's side: a record that is
// present but flattened by the DNS provider, a record pointing somewhere else,
// and a domain with no record at all all looked identical.
//
// Control-plane only: this performs outbound DNS lookups and is meant to run in
// the backend, never in the worker.
package trackdns

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"
)

// Code classifies the outcome for the API and the UI. It is stable and
// machine-readable; Reason is the sentence a human reads.
const (
	// CodeVerified means the subdomain resolves to the tracking host.
	CodeVerified = "verified"
	// CodeUnset means no custom tracking domain is configured.
	CodeUnset = "unset"
	// CodeNoTarget means this install has no TRACKING_DOMAIN, so there is
	// nothing for the customer to point a record at. An operator problem.
	CodeNoTarget = "no_target"
	// CodeNotFound means the name does not exist in DNS yet.
	CodeNotFound = "not_found"
	// CodeWrongTarget means the name resolves, but not to the tracking host.
	CodeWrongTarget = "wrong_target"
	// CodeLookupError means the resolver failed for a reason other than the
	// record being absent. Transient: never persist it as a misconfiguration.
	CodeLookupError = "lookup_error"
)

// Method records how a verified domain was matched.
const (
	MethodCNAME   = "cname"
	MethodAddress = "address"
)

// Result is the outcome of one verification.
type Result struct {
	// Domain is the customer's tracking subdomain, normalized.
	Domain string `json:"domain"`
	// Target is the host the record has to point at (this install's tracking
	// host), empty when the install has none configured.
	Target   string `json:"target"`
	Verified bool   `json:"verified"`
	Code     string `json:"code"`
	// Method is cname or address on success, empty otherwise.
	Method string `json:"method,omitempty"`
	// Observed is what DNS actually returned, so a customer comparing it with
	// what they typed can see the typo themselves.
	Observed string `json:"observed,omitempty"`
	// Reason is always set and always safe to show to the customer.
	Reason string `json:"reason"`
	// TargetUnresolvable reports that the record is correct but the tracking
	// host itself has no DNS record, so links would not load. That is an
	// operator fault and must not hold the customer's domain unverified: the
	// shared host they would fall back to is exactly the same dead host.
	TargetUnresolvable bool `json:"target_unresolvable"`
}

// Resolver is the slice of net.Resolver this package uses, so the matching
// logic is unit-testable without DNS. *net.Resolver satisfies it.
type Resolver interface {
	LookupCNAME(ctx context.Context, host string) (string, error)
	LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error)
}

const lookupTimeout = 5 * time.Second

// Verify resolves domain and reports whether it points at target. Both are
// bare hostnames; a port on either is ignored (DNS has no ports).
func Verify(ctx context.Context, domain, target string) Result {
	c, cancel := context.WithTimeout(ctx, lookupTimeout)
	defer cancel()
	return VerifyWith(c, &net.Resolver{}, domain, target)
}

// DefaultResolver is what Verify uses, exported so a caller running many
// lookups can time-box each one itself.
var DefaultResolver Resolver = &net.Resolver{}

// VerifyWith is Verify with the resolver injected.
func VerifyWith(ctx context.Context, r Resolver, domain, target string) Result {
	res := verify(ctx, r, domain, target)

	// A tracking host that does not itself exist is the operator's problem, and
	// it has to be said whatever the customer's own record looks like:
	// otherwise the answer is "point a CNAME at this host", about a host that
	// nothing can point at.
	if res.TargetUnresolvable {
		if res.Verified {
			res.Reason = fmt.Sprintf("%s points at %s, but %s has no DNS record of its own, so opens and clicks will not record. Ask your administrator to check the tracking host.", res.Domain, res.Target, res.Target)
		} else {
			res.Reason += fmt.Sprintf(" Note that %s has no DNS record of its own right now, so ask your administrator to check the tracking host as well.", res.Target)
		}
	}
	return res
}

func verify(ctx context.Context, r Resolver, domain, target string) Result {
	domain = normalize(domain)
	target = normalize(target)

	res := Result{Domain: domain, Target: target}

	switch {
	case domain == "":
		res.Code = CodeUnset
		res.Reason = "No custom tracking domain is set, so opens and clicks go through the shared tracking host."
		return res
	case target == "":
		res.Code = CodeNoTarget
		res.Reason = "This Pegasusbound install has no tracking host configured, so there is nothing to point a CNAME at yet. Ask your administrator to set TRACKING_DOMAIN."
		return res
	case domain == target:
		// The shared host itself. Nothing to check, and nothing gained.
		res.Verified = true
		res.Code = CodeVerified
		res.Method = MethodCNAME
		res.Observed = target
		res.Reason = "This is the shared tracking host, so it is already in place."
		return res
	}

	// The tracking host's own addresses are needed twice: to compare against a
	// flattened record, and to notice that the host customers are being told to
	// point at does not itself resolve.
	targetIPs, targetErr := r.LookupIPAddr(ctx, target)
	res.TargetUnresolvable = notFound(targetErr)

	cname, cnameErr := r.LookupCNAME(ctx, domain)
	observed := normalize(cname)

	switch {
	case observed != "" && matchesTarget(observed, target) && observed != domain:
		res.Verified = true
		res.Code = CodeVerified
		res.Method = MethodCNAME
		res.Observed = observed
		res.Reason = fmt.Sprintf("%s points at %s.", domain, target)
	case notFound(cnameErr):
		res.Code = CodeNotFound
		res.Reason = fmt.Sprintf("No DNS record for %s yet. Add the CNAME at your DNS provider, then verify again: a new record usually appears within minutes, but can take up to an hour.", domain)
		return res
	case cnameErr != nil:
		res.Code = CodeLookupError
		res.Reason = fmt.Sprintf("Could not look up %s right now. This is a temporary DNS problem on our side, not a problem with your record. Try verifying again in a minute.", domain)
		return res
	default:
		// No CNAME in the answer (the resolver echoes the queried name back),
		// or one pointing elsewhere. Providers that flatten CNAMEs, serve ALIAS
		// records, or proxy the name return address records instead, and those
		// are a working configuration that the old check called "pending"
		// forever. Compare addresses before giving up.
		domainIPs, domainErr := r.LookupIPAddr(ctx, domain)
		switch {
		case len(domainIPs) > 0 && len(targetIPs) > 0 && sharesAddress(domainIPs, targetIPs):
			res.Verified = true
			res.Code = CodeVerified
			res.Method = MethodAddress
			res.Observed = strings.Join(ipStrings(domainIPs), ", ")
			res.Reason = fmt.Sprintf("%s resolves to the same address as %s. Your DNS provider flattens the CNAME, which works the same way.", domain, target)
		case notFound(domainErr) && observed == domain:
			res.Code = CodeNotFound
			res.Reason = fmt.Sprintf("%s has no address in DNS. Add the CNAME at your DNS provider, then verify again.", domain)
			return res
		case observed != "" && observed != domain:
			res.Code = CodeWrongTarget
			res.Observed = observed
			res.Reason = fmt.Sprintf("%s points at %s, not at %s. Edit the CNAME to use %s as its value.", domain, observed, target, target)
			return res
		case domainErr != nil && !notFound(domainErr):
			res.Code = CodeLookupError
			res.Reason = fmt.Sprintf("Could not look up %s right now. This is a temporary DNS problem on our side, not a problem with your record. Try verifying again in a minute.", domain)
			return res
		default:
			res.Code = CodeWrongTarget
			res.Observed = strings.Join(ipStrings(domainIPs), ", ")
			res.Reason = fmt.Sprintf("%s resolves, but not to %s. It has to be a CNAME with %s as its value, with no other record on the same name.", domain, target, target)
			return res
		}
	}

	return res
}

// matchesTarget accepts the target itself or a name under it, so a tracking
// host fronted by per-region names (edge-1.t.example.com) still verifies, while
// a lookalike suffix (t.example.com.attacker.net) does not. The old
// strings.Contains compare accepted both.
func matchesTarget(observed, target string) bool {
	return observed == target || strings.HasSuffix(observed, "."+target)
}

func normalize(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	v = strings.TrimSuffix(v, ".")
	if h, _, err := net.SplitHostPort(v); err == nil {
		v = h
	}
	return v
}

// notFound reports an authoritative "this name does not exist" as opposed to a
// timeout or SERVFAIL, which say nothing about the record.
func notFound(err error) bool {
	if err == nil {
		return false
	}
	var dnsErr *net.DNSError
	return errors.As(err, &dnsErr) && dnsErr.IsNotFound
}

func sharesAddress(a, b []net.IPAddr) bool {
	for _, x := range a {
		for _, y := range b {
			if x.IP.Equal(y.IP) {
				return true
			}
		}
	}
	return false
}

func ipStrings(ips []net.IPAddr) []string {
	out := make([]string, 0, len(ips))
	for _, ip := range ips {
		out = append(out, ip.IP.String())
	}
	return out
}
