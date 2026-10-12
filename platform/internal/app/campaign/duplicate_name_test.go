package campaign

import (
	"strings"
	"testing"

	"github.com/pegasusbound/pegasusbound/internal/utils/validate"
)

func TestDuplicateNameStaysWithinTheCampaignNameCap(t *testing.T) {
	cases := map[string]string{
		"Q3 outbound":                     "Q3 outbound (copy)",
		"  padded  ":                      "padded (copy)",
		"Q3 outbound (copy)":              "Q3 outbound (copy 2)",
		"Q3 outbound (copy 7)":            "Q3 outbound (copy 8)",
		"copy (copy) of x":                "copy (copy) of x (copy)",
		strings.Repeat("é", 25):           strings.Repeat("é", 21) + " (copy)",
		strings.Repeat("a", 50):           strings.Repeat("a", 43) + " (copy)",
		strings.Repeat("b", 42) + " tail": strings.Repeat("b", 42) + " (copy)",
	}
	for in, want := range cases {
		got := duplicateName(in)
		if got != want {
			t.Errorf("duplicateName(%q) = %q, want %q", in, got, want)
		}
		if xerr := validate.CampaignName(got); xerr != nil {
			t.Errorf("duplicateName(%q) = %q fails validation: %v", in, got, xerr)
		}
	}
}
