package validate

import (
	"net"
	"strings"
)

// TrackingHostname reports whether host is usable as a tracking domain: a bare
// hostname with no scheme, no port, no path, no raw IP literal and no
// internal/metadata name, mirroring the webhook-SSRF posture. Mailbox and
// campaign tracking domains share one definition so a host that is valid on one
// cannot be invalid on the other.
func TrackingHostname(host string) bool {
	if host == "" || len(host) > 253 {
		return false
	}
	if strings.Contains(host, "://") || strings.ContainsAny(host, " \t\r\n/\\?#@:") {
		return false
	}
	if net.ParseIP(host) != nil {
		return false
	}
	lower := strings.ToLower(host)
	if lower == "localhost" || strings.HasSuffix(lower, ".localhost") || lower == "metadata.google.internal" {
		return false
	}
	// A single label has no public zone to own, and a trailing dot is a
	// fully-qualified form nobody types into this field.
	if !strings.Contains(lower, ".") || strings.HasPrefix(lower, ".") || strings.HasSuffix(lower, ".") {
		return false
	}
	for _, label := range strings.Split(lower, ".") {
		if label == "" || len(label) > 63 {
			return false
		}
		if strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		for _, c := range label {
			if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
				return false
			}
		}
	}
	// The last label is the TLD: letters only, at least two of them.
	tld := lower[strings.LastIndex(lower, ".")+1:]
	if len(tld) < 2 {
		return false
	}
	for _, c := range tld {
		if c < 'a' || c > 'z' {
			return false
		}
	}
	return true
}
