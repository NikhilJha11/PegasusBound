package trackdns

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// These run against Go's real resolver over a local DNS server, because the
// behaviour that matters here is the resolver's, not the fake's: LookupCNAME
// echoes the queried name back when there is no CNAME (so a flattened record
// looks like no record at all), and it answers a dangling CNAME without an
// error (so a record pointing at a host that does not exist looked verified).

type zone struct {
	cname map[string]string
	a     map[string][4]byte
}

func serveZone(t *testing.T, z zone) *net.Resolver {
	t.Helper()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { pc.Close() })

	go func() {
		buf := make([]byte, 1500)
		for {
			n, addr, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			msg, err := answer(buf[:n], z)
			if err != nil {
				continue
			}
			if _, err := pc.WriteTo(msg, addr); err != nil {
				return
			}
		}
	}()

	server := pc.LocalAddr().String()
	return &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "udp", server)
		},
	}
}

func answer(query []byte, z zone) ([]byte, error) {
	var p dnsmessage.Parser
	hdr, err := p.Start(query)
	if err != nil {
		return nil, err
	}
	q, err := p.Question()
	if err != nil {
		return nil, err
	}
	name := strings.ToLower(q.Name.String())

	cname, hasCNAME := z.cname[name]
	resolved := name
	if hasCNAME {
		resolved = cname
	}
	a, hasA := z.a[resolved]

	if !hasCNAME && !hasA {
		b := dnsmessage.NewBuilder(nil, dnsmessage.Header{ID: hdr.ID, Response: true, Authoritative: true, RCode: dnsmessage.RCodeNameError})
		if err := b.StartQuestions(); err != nil {
			return nil, err
		}
		if err := b.Question(q); err != nil {
			return nil, err
		}
		return b.Finish()
	}

	b := dnsmessage.NewBuilder(nil, dnsmessage.Header{ID: hdr.ID, Response: true, Authoritative: true})
	b.EnableCompression()
	if err := b.StartQuestions(); err != nil {
		return nil, err
	}
	if err := b.Question(q); err != nil {
		return nil, err
	}
	if err := b.StartAnswers(); err != nil {
		return nil, err
	}
	rh := func(n string) dnsmessage.ResourceHeader {
		return dnsmessage.ResourceHeader{Name: dnsmessage.MustNewName(n), Class: dnsmessage.ClassINET, TTL: 60}
	}
	if hasCNAME {
		if err := b.CNAMEResource(rh(name), dnsmessage.CNAMEResource{CNAME: dnsmessage.MustNewName(cname)}); err != nil {
			return nil, err
		}
	}
	if hasA && q.Type == dnsmessage.TypeA {
		if err := b.AResource(rh(resolved), dnsmessage.AResource{A: a}); err != nil {
			return nil, err
		}
	}
	return b.Finish()
}

func TestRealResolverVerifiesCNAME(t *testing.T) {
	r := serveZone(t, zone{
		cname: map[string]string{"track.acme.test.": "t.pegasusbound.test."},
		a:     map[string][4]byte{"t.pegasusbound.test.": {203, 0, 113, 10}},
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res := VerifyWith(ctx, r, "track.acme.test", "t.pegasusbound.test")
	if !res.Verified || res.Method != MethodCNAME {
		t.Fatalf("expected cname verification, got %+v", res)
	}
}

func TestRealResolverVerifiesFlattenedRecord(t *testing.T) {
	r := serveZone(t, zone{
		cname: map[string]string{},
		a: map[string][4]byte{
			"track.acme.test.":     {203, 0, 113, 10},
			"t.pegasusbound.test.": {203, 0, 113, 10},
		},
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res := VerifyWith(ctx, r, "track.acme.test", "t.pegasusbound.test")
	if !res.Verified || res.Method != MethodAddress {
		t.Fatalf("a flattened record is a working record, got %+v", res)
	}
}

// The exact shape of the hosted bug in issue #173: the CNAME target customers
// were told to use did not exist, so the record was right and tracking was
// dead. It stays verified and the reason says whose problem it is.
func TestRealResolverDanglingTargetIsReported(t *testing.T) {
	r := serveZone(t, zone{
		cname: map[string]string{"track.acme.test.": "t.pegasusbound.test."},
		a:     map[string][4]byte{},
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res := VerifyWith(ctx, r, "track.acme.test", "t.pegasusbound.test")
	if !res.Verified || !res.TargetUnresolvable {
		t.Fatalf("expected verified-but-dead, got %+v", res)
	}
}

func TestRealResolverMissingRecord(t *testing.T) {
	r := serveZone(t, zone{cname: map[string]string{}, a: map[string][4]byte{"t.pegasusbound.test.": {203, 0, 113, 10}}})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res := VerifyWith(ctx, r, "xyz.tracking.test", "t.pegasusbound.test")
	if res.Verified || res.Code != CodeNotFound {
		t.Fatalf("expected not_found, got %+v", res)
	}
}
