// Package signuprisk scores a signup's email address and source IP.
//
// It is pure: no DNS, no network, no database. Callers score at registration
// and persist the result. Nothing here blocks a signup on its own: a single
// weak signal is wrong too often, and refusing an account over one heuristic
// turns a false positive into a lost customer with no recourse.
package signuprisk

import (
	"net"
	"strings"
)

// Result is what one signup scored, and why.
type Result struct {
	// Score is 0-100. Higher is riskier.
	Score int
	// Reasons are the findings, for the evidence record and admin review.
	Reasons []string
	// Findings are the same reasons with their own weight and class, so a
	// caller can file them separately rather than fusing one aggregate score
	// under one class.
	Findings []Finding
	// Disposable is called out separately because it is the single strongest
	// predictor: a throwaway address correlates with abuse far more tightly
	// than any of the softer signals here.
	Disposable bool
}

// Finding is one weighted reason. Substantive marks a finding about the account
// itself; the rest describe how the signup looked, which ordinary customers
// also do.
type Finding struct {
	Reason      string
	Weight      int
	Substantive bool
}

// Substantive totals the findings that are about the account itself.
func (r Result) Substantive() []Finding { return r.pick(true) }

// Circumstantial totals the findings that only describe how the signup looked.
func (r Result) Circumstantial() []Finding { return r.pick(false) }

func (r Result) pick(substantive bool) []Finding {
	out := make([]Finding, 0, len(r.Findings))
	for _, f := range r.Findings {
		if f.Substantive == substantive {
			out = append(out, f)
		}
	}
	return out
}

// Weights. Deliberately small individually: this feeds a fused org score where
// several weak signals combine, rather than deciding anything alone.
const (
	weightDisposable   = 35
	weightPlusAddress  = 5
	weightNoTLD        = 20
	weightPrivateIP    = 0 // a self-hosted install signing up over a LAN is normal
	weightMissingIP    = 5
	weightSuspiciousTZ = 0
)

// disposableDomains is a deliberately small, high-confidence list. A large
// scraped list ages badly and starts flagging real providers; these are
// unambiguous throwaway services.
var disposableDomains = map[string]bool{
	"mailinator.com": true, "guerrillamail.com": true, "10minutemail.com": true,
	"tempmail.com": true, "temp-mail.org": true, "throwawaymail.com": true,
	"yopmail.com": true, "trashmail.com": true, "getnada.com": true,
	"dispostable.com": true, "maildrop.cc": true, "sharklasers.com": true,
	"guerrillamailblock.com": true, "spam4.me": true, "grr.la": true,
	"mailnesia.com": true, "mytemp.email": true, "fakeinbox.com": true,
	"tempinbox.com": true, "emailondeck.com": true, "moakt.com": true,
	"tempr.email": true, "discard.email": true, "mailcatch.com": true,
}

// freeProviders are consumer mailbox hosts. NOT scored: a business emailing
// from Gmail is completely ordinary, and treating it as risk would flag a large
// share of legitimate small customers.
var freeProviders = map[string]bool{
	"gmail.com": true, "googlemail.com": true, "outlook.com": true,
	"hotmail.com": true, "live.com": true, "yahoo.com": true,
	"icloud.com": true, "proton.me": true, "protonmail.com": true,
	"aol.com": true, "gmx.com": true, "mail.com": true, "zoho.com": true,
}

// IsDisposable reports whether an address is on a known throwaway domain.
// Exported so the contact-import gate scores against the same list rather than
// keeping a second copy that drifts.
func IsDisposable(email string) bool {
	return disposableDomains[domainOf(email)]
}

// Score assesses one signup.
func Score(email, ipaddr string) Result {
	res := Result{Reasons: []string{}}
	add := func(reason string, weight int, substantive bool) {
		res.Findings = append(res.Findings, Finding{Reason: reason, Weight: weight, Substantive: substantive})
		res.Reasons = append(res.Reasons, reason)
		res.Score += weight
	}

	domain := domainOf(email)
	switch {
	case domain == "":
		add("signup address has no domain", weightNoTLD, false)
	case disposableDomains[domain]:
		// The only finding here about the account rather than its appearance.
		res.Disposable = true
		add("signup used a disposable email domain", weightDisposable, true)
	case !strings.Contains(domain, "."):
		add("signup domain has no public suffix", weightNoTLD, false)
	}

	// A plus-address at a free provider is how one person opens many accounts.
	// Weak on its own: plenty of people tag their real mail this way.
	if local := localOf(email); strings.Contains(local, "+") && freeProviders[domain] {
		add("signup used a tagged address at a free provider", weightPlusAddress, false)
	}

	if strings.TrimSpace(ipaddr) == "" {
		add("signup arrived with no source address", weightMissingIP, false)
	}

	if res.Score > 100 {
		res.Score = 100
	}
	return res
}

// Normalize collapses an address to the identity behind it, so a plus-tag or
// dotted Gmail local part cannot be used to open a second account that looks
// unrelated. Used for correlation, never for login.
func Normalize(email string) string {
	local, domain := localOf(email), domainOf(email)
	if local == "" || domain == "" {
		return strings.ToLower(strings.TrimSpace(email))
	}
	if i := strings.Index(local, "+"); i >= 0 {
		local = local[:i]
	}
	// Only Google ignores dots. Applying it everywhere would merge genuinely
	// different addresses at providers that treat them as distinct.
	if domain == "gmail.com" || domain == "googlemail.com" {
		local = strings.ReplaceAll(local, ".", "")
		domain = "gmail.com"
	}
	return local + "@" + domain
}

// PrivateIP reports whether an address is loopback, link-local or RFC1918.
// Self-hosted installs sign up over a LAN constantly, so this is recorded for
// context and not scored.
func PrivateIP(ipaddr string) bool {
	ip := net.ParseIP(strings.TrimSpace(ipaddr))
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

func localOf(email string) string {
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(email[:at]))
}

func domainOf(email string) string {
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(email[at+1:]))
}
