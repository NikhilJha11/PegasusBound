package models

import (
	"testing"

	"github.com/google/uuid"
)

func TestValidateSegmentConditionsNormalizes(t *testing.T) {
	self := uuid.New()
	conds := []SegmentCondition{
		{Field: " company ", Operator: "contains", Value: "acme"},
		{Field: "custom.Job Title", Operator: "is_empty", Value: "junk", Values: []string{"x"}},
		{Field: "emails_opened", Operator: "gte", Value: " 3 "},
		{Field: "created_at", Operator: "after", Value: "2026-01-15"},
		{Field: "last_replied_at", Operator: "within_days", Value: "30"},
		{Field: "source", Operator: "in", Values: []string{"import", "api"}},
		{Field: "category", Operator: "in", Values: []string{uuid.New().String()}},
	}
	if err := ValidateSegmentConditions(conds, &self); err != nil {
		t.Fatalf("valid conditions rejected: %v", err)
	}
	if conds[0].Field != "company" {
		t.Errorf("field not trimmed: %q", conds[0].Field)
	}
	if conds[1].Value != "" || conds[1].Values != nil {
		t.Errorf("valueless operator kept values: %+v", conds[1])
	}
	if conds[2].Value != "3" {
		t.Errorf("number not normalized: %q", conds[2].Value)
	}
	if conds[3].Value != "2026-01-15T00:00:00Z" {
		t.Errorf("date not normalized: %q", conds[3].Value)
	}
}

func TestValidateSegmentConditionsRejects(t *testing.T) {
	self := uuid.New()
	bad := []struct {
		name string
		cond SegmentCondition
	}{
		{"unknown field", SegmentCondition{Field: "nope", Operator: "equals", Value: "x"}},
		{"wrong operator", SegmentCondition{Field: "subscribed", Operator: "contains", Value: "x"}},
		{"missing value", SegmentCondition{Field: "email", Operator: "equals"}},
		{"empty list", SegmentCondition{Field: "category", Operator: "in"}},
		{"bad enum", SegmentCondition{Field: "source", Operator: "in", Values: []string{"martian"}}},
		{"bad uuid", SegmentCondition{Field: "campaign", Operator: "in", Values: []string{"abc"}}},
		{"negative number", SegmentCondition{Field: "emails_sent", Operator: "gt", Value: "-1"}},
		{"days out of range", SegmentCondition{Field: "created_at", Operator: "within_days", Value: "0"}},
		{"bad date", SegmentCondition{Field: "updated_at", Operator: "before", Value: "yesterday"}},
		{"self reference", SegmentCondition{Field: "segment", Operator: "in", Values: []string{self.String()}}},
		{"bad custom key", SegmentCondition{Field: "custom.", Operator: "equals", Value: "x"}},
	}
	for _, tc := range bad {
		if err := ValidateSegmentConditions([]SegmentCondition{tc.cond}, &self); err == nil {
			t.Errorf("%s: accepted", tc.name)
		}
	}
	many := make([]SegmentCondition, SegmentMaxConditions+1)
	for i := range many {
		many[i] = SegmentCondition{Field: "email", Operator: "is_not_empty"}
	}
	if err := ValidateSegmentConditions(many, nil); err == nil {
		t.Errorf("over the condition cap accepted")
	}
}

func TestSegmentReferences(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	refs := SegmentReferences([]SegmentCondition{
		{Field: "segment", Operator: "in", Values: []string{a.String(), "junk"}},
		{Field: "category", Operator: "in", Values: []string{b.String()}},
		{Field: "segment", Operator: "not_in", Values: []string{b.String()}},
	})
	if len(refs) != 2 || refs[0] != a || refs[1] != b {
		t.Fatalf("refs = %v", refs)
	}
}
