package validate

import "testing"

func TestWarmupFolder(t *testing.T) {
	for _, ok := range []string{"", "Pegasusbound", "Warm up", "Réputation", "  Pegasusbound  "} {
		if err := WarmupFolder(ok); err != nil {
			t.Errorf("WarmupFolder(%q) refused: %v", ok, err)
		}
	}
	// A separator would nest the folder under whatever it names, and a control
	// character is refused by the provider rather than by us.
	bad := []string{"INBOX.Pegasusbound", "a/b", `a\b`, "a%b", "a*b", `a"b`, "warm\nup", "warm\x00up"}
	for _, name := range bad {
		if err := WarmupFolder(name); err == nil {
			t.Errorf("WarmupFolder(%q) should have been refused", name)
		}
	}
	long := make([]rune, 65)
	for i := range long {
		long[i] = 'a'
	}
	if err := WarmupFolder(string(long)); err == nil {
		t.Error("a 65-character folder name should have been refused")
	}
}
