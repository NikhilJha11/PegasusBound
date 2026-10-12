package repository

import (
	"context"
	"net/mail"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Issue #148: the cross-account view. These prove the queries against the real
// schema, including the case that would hurt most: NOT clustering ordinary
// customers who happen to share an office address.
//
//	PEGASUSBOUND_TEST_DB=postgres://pegasusbound:pegasusbound@localhost:15432/pegasusbound_dev?sslmode=disable \
//	  go test ./internal/repository/ -run LiveCorrelation -v

// makeOrg creates an owner with the given signup metadata and their workspace.
func makeOrg(t *testing.T, ip, normalized string) uuid.UUID {
	t.Helper()
	handle, pool := liveContactDB(t)
	ctx := context.Background()

	addr, err := mail.ParseAddress("corr-" + uuid.New().String()[:8] + "@test.local")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	u, err := NewUserRepostory(handle, nil).CreateUser(ctx, addr, "hash")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE users SET signup_ip = NULLIF($2,'')::inet, signup_email_normalized = NULLIF($3,'') WHERE id = $1`,
		u.ID, ip, normalized); err != nil {
		t.Fatalf("set signup metadata: %v", err)
	}
	org := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO organizations (id, name, slug, owner_user_id) VALUES ($1, 'Corr', $2, $3)`,
		org, "corr-"+org.String()[:8], u.ID); err != nil {
		t.Fatalf("create org: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		if _, err := pool.Exec(c, `DELETE FROM email_accounts WHERE organization_id = $1`, org); err != nil {
			t.Errorf("cleanup mailboxes: %v", err)
		}
		if _, err := pool.Exec(c, `DELETE FROM organizations WHERE id = $1`, org); err != nil {
			t.Errorf("cleanup org: %v", err)
		}
		if _, err := pool.Exec(c, `DELETE FROM users WHERE id = $1`, u.ID); err != nil {
			t.Errorf("cleanup user: %v", err)
		}
	})
	return org
}

func contains(ids []uuid.UUID, want uuid.UUID) bool {
	for _, id := range ids {
		if id == want {
			return true
		}
	}
	return false
}

func TestLiveCorrelationClustersBySignupIP(t *testing.T) {
	handle, _ := liveContactDB(t)
	repo := NewCorrelationRepository(handle)

	ip := "198.51.100.77"
	a, b, c := makeOrg(t, ip, ""), makeOrg(t, ip, ""), makeOrg(t, ip, "")
	// A fourth from elsewhere must not be swept in.
	other := makeOrg(t, "203.0.113.9", "")

	clusters, err := repo.ClustersBySignupIP(context.Background(), 3, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("ClustersBySignupIP: %v", err)
	}
	var found *Cluster
	for i := range clusters {
		if clusters[i].Key == ip {
			found = &clusters[i]
		}
	}
	if found == nil {
		t.Fatalf("no cluster for %s; got %d clusters", ip, len(clusters))
	}
	for _, want := range []uuid.UUID{a, b, c} {
		if !contains(found.OrganizationIDs, want) {
			t.Errorf("cluster is missing %s", want)
		}
	}
	if contains(found.OrganizationIDs, other) {
		t.Error("an organization from a different address was swept into the cluster")
	}
}

// The failure that would hurt most: a self-hosted install signing up over a
// LAN is the normal case, and every such install shares 192.168.x.x.
func TestLiveCorrelationIgnoresPrivateAddresses(t *testing.T) {
	handle, _ := liveContactDB(t)
	repo := NewCorrelationRepository(handle)

	for i := 0; i < 4; i++ {
		makeOrg(t, "192.168.1.50", "")
	}
	clusters, err := repo.ClustersBySignupIP(context.Background(), 3, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("ClustersBySignupIP: %v", err)
	}
	for _, c := range clusters {
		if c.Key == "192.168.1.50" {
			t.Error("a LAN address was treated as a cluster; every self-hosted install shares one")
		}
	}
}

func TestLiveCorrelationClustersByIdentity(t *testing.T) {
	handle, _ := liveContactDB(t)
	repo := NewCorrelationRepository(handle)

	identity := "oneperson" + uuid.New().String()[:6] + "@gmail.com"
	a, b, c := makeOrg(t, "", identity), makeOrg(t, "", identity), makeOrg(t, "", identity)

	clusters, err := repo.ClustersBySignupIdentity(context.Background(), 3, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("ClustersBySignupIdentity: %v", err)
	}
	for _, cl := range clusters {
		if cl.Key != identity {
			continue
		}
		for _, want := range []uuid.UUID{a, b, c} {
			if !contains(cl.OrganizationIDs, want) {
				t.Errorf("cluster is missing %s", want)
			}
		}
		return
	}
	t.Fatalf("no cluster for %s", identity)
}

// Two organizations is a coincidence; the floor is three.
func TestLiveCorrelationNeedsMoreThanTwo(t *testing.T) {
	handle, _ := liveContactDB(t)
	repo := NewCorrelationRepository(handle)

	ip := "198.51.100.88"
	makeOrg(t, ip, "")
	makeOrg(t, ip, "")

	clusters, err := repo.ClustersBySignupIP(context.Background(), 3, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("ClustersBySignupIP: %v", err)
	}
	for _, c := range clusters {
		if c.Key == ip {
			t.Errorf("two organizations were reported as a cluster: %+v", c)
		}
	}
}

// IPv6 LANs cluster just as wrongly as IPv4 ones: a self-hosted install
// reached over ULA or link-local is the normal case, not a ring.
func TestLiveCorrelationIgnoresPrivateIPv6(t *testing.T) {
	handle, _ := liveContactDB(t)
	repo := NewCorrelationRepository(handle)

	for _, ip := range []string{"fd00::1", "fe80::1", "::1"} {
		for i := 0; i < 3; i++ {
			makeOrg(t, ip, "")
		}
	}
	clusters, err := repo.ClustersBySignupIP(context.Background(), 3, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("ClustersBySignupIP: %v", err)
	}
	for _, c := range clusters {
		for _, priv := range []string{"fd00::1", "fe80::1", "::1"} {
			if c.Key == priv {
				t.Errorf("private IPv6 %s was treated as a cluster", priv)
			}
		}
	}
}
