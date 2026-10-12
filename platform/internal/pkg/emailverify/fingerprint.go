package emailverify

import (
	"strings"
	"sync"
	"time"
)

const (
	// domainCacheTTL bounds how long a domain fact (no MX, catch-all,
	// undisclosing provider) is trusted before it is re-learned.
	domainCacheTTL = 24 * time.Hour
	// domainCacheMax caps the in-process cache; the oldest entries are evicted.
	domainCacheMax = 50_000
	// maxMXAttempts bounds how many MX hosts one address may cost.
	maxMXAttempts = 3
)

type domainKind int

const (
	domainNoMX domainKind = iota + 1
	domainCatchAll
	domainUndisclosed
)

type domainFact struct {
	kind   domainKind
	reason string
	at     time.Time
}

// domainCache is a small TTL map keyed by domain. In-process only: it is a
// cost optimisation, and a cold cache after a restart is merely slower.
type domainCache struct {
	mu   sync.Mutex
	ttl  time.Duration
	data map[string]domainFact
}

func newDomainCache(ttl time.Duration) *domainCache {
	return &domainCache{ttl: ttl, data: make(map[string]domainFact)}
}

func (c *domainCache) get(domain string) (domainFact, bool) {
	if c == nil {
		return domainFact{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	f, ok := c.data[domain]
	if !ok {
		return domainFact{}, false
	}
	if time.Since(f.at) > c.ttl {
		delete(c.data, domain)
		return domainFact{}, false
	}
	return f, true
}

func (c *domainCache) put(domain string, f domainFact) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.data) >= domainCacheMax {
		// Evict the stalest quarter rather than scanning on every insert.
		cutoff := time.Now().Add(-c.ttl / 4)
		for k, v := range c.data {
			if v.at.Before(cutoff) {
				delete(c.data, k)
			}
		}
		if len(c.data) >= domainCacheMax {
			for k := range c.data {
				delete(c.data, k)
				if len(c.data) < domainCacheMax*3/4 {
					break
				}
			}
		}
	}
	f.at = time.Now()
	c.data[domain] = f
}

// mxFingerprint is what the MX hostnames reveal about the receiving provider.
type mxFingerprint struct {
	name string
	// undisclosed providers accept every RCPT and reject at delivery time, so
	// an accepted probe proves nothing and a rejected one never happens.
	undisclosed bool
}

// undisclosingMX lists MX suffixes of providers whose RCPT answer is not a
// verdict. Microsoft 365 answers 250 for any address on a tenant and bounces
// later; Yahoo/AOL tarpit and accept. Google, by contrast, answers truthfully
// (550 5.1.1) and is left to the probe.
var undisclosingMX = []struct{ suffix, name string }{
	{".mail.protection.outlook.com", "Microsoft 365"},
	{".olc.protection.outlook.com", "Outlook.com"},
	{".mail.eo.outlook.com", "Microsoft 365"},
	{".yahoodns.net", "Yahoo"},
	{".mx.aol.com", "AOL"},
}

func fingerprintMX(hosts []string) mxFingerprint {
	for _, h := range hosts {
		lh := strings.ToLower(strings.TrimSuffix(h, "."))
		for _, u := range undisclosingMX {
			if strings.HasSuffix(lh, u.suffix) {
				return mxFingerprint{name: u.name, undisclosed: true}
			}
		}
	}
	return mxFingerprint{}
}

// roleLocalparts is the same shared-inbox vocabulary the import quality check
// and the launch gate use, so one list is never described three ways.
var roleLocalparts = map[string]bool{
	"info": true, "sales": true, "support": true, "contact": true,
	"admin": true, "hello": true, "help": true, "office": true, "team": true,
	"billing": true, "careers": true, "jobs": true, "marketing": true,
	"noreply": true, "no-reply": true, "webmaster": true,
	"enquiries": true, "enquiry": true, "postmaster": true, "abuse": true,
}

func isRoleLocalpart(local string) bool {
	return roleLocalparts[strings.ToLower(local)]
}
