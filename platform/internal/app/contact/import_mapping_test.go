package contact

import (
	"strings"
	"testing"

	"github.com/pegasusbound/pegasusbound/internal/models"
)

// Issue #207: a mistyped custom-field name used to be reported once per row
// (1,000 identical errors for a 1,000-row file). The mapping is now resolved
// once, before any row is read.

func mapCol(idx int, target models.ContactImportColumnTarget) models.ContactImportColumnMapping {
	return models.ContactImportColumnMapping{Index: idx, Target: target}
}

func TestResolveMapping(t *testing.T) {
	emailCol := mapCol(0, models.ContactImportTargetEmail)

	t.Run("keeps only the columns that go somewhere", func(t *testing.T) {
		cols, xerr := resolveMapping([]models.ContactImportColumnMapping{
			emailCol,
			mapCol(1, models.ContactImportTargetIgnore),
			{Index: 2, Target: models.ContactImportTargetCustom, CustomKey: " Company  Mobile "},
		})
		if xerr != nil {
			t.Fatalf("unexpected error: %s", xerr.Message)
		}
		if len(cols) != 2 {
			t.Fatalf("got %d columns, want 2 (%+v)", len(cols), cols)
		}
		if cols[1].customKey != "Company Mobile" {
			t.Fatalf("key not normalized: %q", cols[1].customKey)
		}
	})

	t.Run("accepts the legacy custom:<key> target", func(t *testing.T) {
		cols, xerr := resolveMapping([]models.ContactImportColumnMapping{
			emailCol, {Index: 1, Target: "custom:plan_tier"},
		})
		if xerr != nil {
			t.Fatalf("unexpected error: %s", xerr.Message)
		}
		if cols[1].target != models.ContactImportTargetCustom || cols[1].customKey != "plan_tier" {
			t.Fatalf("legacy target not resolved: %+v", cols[1])
		}
	})

	t.Run("an explicit custom_key wins over the target suffix", func(t *testing.T) {
		cols, _ := resolveMapping([]models.ContactImportColumnMapping{
			emailCol, {Index: 1, Target: "custom:old", CustomKey: "new"},
		})
		if cols[1].customKey != "new" {
			t.Fatalf("custom_key ignored: %q", cols[1].customKey)
		}
	})

	for name, tc := range map[string]struct {
		mapping []models.ContactImportColumnMapping
		wants   string
	}{
		"unusable name": {
			[]models.ContactImportColumnMapping{emailCol, {Index: 5, Target: models.ContactImportTargetCustom, CustomKey: "Company/Mobile"}},
			"Company/Mobile",
		},
		"no name": {
			[]models.ContactImportColumnMapping{emailCol, {Index: 5, Target: models.ContactImportTargetCustom}},
			"column 6 is mapped to a custom field but has no name",
		},
		"no email": {
			[]models.ContactImportColumnMapping{mapCol(0, models.ContactImportTargetFirstName)},
			"Email",
		},
		"unknown target": {
			[]models.ContactImportColumnMapping{emailCol, mapCol(1, "middle_name")},
			"unknown target",
		},
		"negative index": {
			[]models.ContactImportColumnMapping{{Index: -1, Target: models.ContactImportTargetEmail}},
			"out of range",
		},
	} {
		t.Run(name, func(t *testing.T) {
			_, xerr := resolveMapping(tc.mapping)
			if xerr == nil {
				t.Fatalf("expected an error mentioning %q", tc.wants)
			}
			if !strings.Contains(xerr.Message, tc.wants) {
				t.Fatalf("message %q does not mention %q", xerr.Message, tc.wants)
			}
		})
	}
}

func TestBuildAddContactReadsEveryTarget(t *testing.T) {
	cols, xerr := resolveMapping([]models.ContactImportColumnMapping{
		mapCol(0, models.ContactImportTargetEmail),
		mapCol(1, models.ContactImportTargetFirstName),
		mapCol(2, models.ContactImportTargetSubscribed),
		mapCol(3, models.ContactImportTargetCategories),
		{Index: 4, Target: models.ContactImportTargetCustom, CustomKey: "Company Mobile"},
	})
	if xerr != nil {
		t.Fatalf("resolve: %s", xerr.Message)
	}

	row := []string{"dana@acme.com", "Dana", "unsubscribed", "Agency; Enterprise , Agency", "+15550000"}
	ac, cats, reason := buildAddContact(row, cols, nil, nil)
	if reason != "" {
		t.Fatalf("row rejected: %s", reason)
	}
	if ac.Email != "dana@acme.com" || ac.FirstName != "Dana" {
		t.Fatalf("identity fields not read: %+v", ac)
	}
	if ac.Subscribed == nil || *ac.Subscribed {
		t.Fatalf("subscribed column not honoured: %v", ac.Subscribed)
	}
	if ac.CustomFields["Company Mobile"] != "+15550000" {
		t.Fatalf("custom field not stored: %+v", ac.CustomFields)
	}
	if len(cats) != 2 || cats[0] != "Agency" || cats[1] != "Enterprise" {
		t.Fatalf("category titles: %+v", cats)
	}

	// No subscribed column means "leave it to the caller's default", which is
	// what keeps an update from resubscribing someone who opted out.
	bare, _, _ := buildAddContact([]string{"x@y.com"}, cols[:1], nil, nil)
	if bare.Subscribed != nil {
		t.Fatalf("subscribed was decided without a column: %v", *bare.Subscribed)
	}

	// A value the importer cannot read fails that row, not the import.
	if _, _, reason = buildAddContact([]string{"a@b.com", "A", "maybe", "", ""}, cols, nil, nil); reason == "" {
		t.Fatal("an unreadable subscribed value should fail the row")
	}
}
