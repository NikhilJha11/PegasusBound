package repository

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestRemapBranchTargetsRewritesKnownStepsAndStopsDanglingOnes(t *testing.T) {
	oldA, oldB, gone := uuid.New(), uuid.New(), uuid.New()
	newA, newB := uuid.New(), uuid.New()
	idMap := map[uuid.UUID]uuid.UUID{oldA: newA, oldB: newB}

	in := []byte(`{"branches":[
		{"branch_id":"b1","target_step_id":"` + oldB.String() + `","conditions":[{"field":"opened","operator":"is_true","extra":"kept"}],"instant":false},
		{"branch_id":"b2","target_step_id":"` + gone.String() + `"},
		{"branch_id":"b3","target_step_id":null},
		{"branch_id":"b4"}
	],"editor_note":"survives"}`)

	out, err := RemapBranchTargets(in, idMap)
	if err != nil {
		t.Fatalf("remap: %v", err)
	}
	var got struct {
		Branches []struct {
			BranchID string          `json:"branch_id"`
			Target   *string         `json:"target_step_id"`
			Cond     json.RawMessage `json:"conditions"`
			Instant  *bool           `json:"instant"`
		} `json:"branches"`
		Note string `json:"editor_note"`
	}
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Note != "survives" {
		t.Errorf("unknown top-level field dropped: %s", out)
	}
	if len(got.Branches) != 4 {
		t.Fatalf("branches = %d, want 4", len(got.Branches))
	}
	if got.Branches[0].Target == nil || *got.Branches[0].Target != newB.String() {
		t.Errorf("mapped target = %v, want %s", got.Branches[0].Target, newB)
	}
	if got.Branches[0].Instant == nil || *got.Branches[0].Instant {
		t.Errorf("instant flag not preserved: %s", out)
	}
	if string(got.Branches[0].Cond) == "" || !json.Valid(got.Branches[0].Cond) {
		t.Errorf("conditions not preserved: %s", out)
	}
	if got.Branches[1].Target != nil {
		t.Errorf("dangling target should become null, got %s", *got.Branches[1].Target)
	}
	if got.Branches[2].Target != nil {
		t.Errorf("explicit null target changed: %s", out)
	}
	if got.Branches[3].Target != nil {
		t.Errorf("absent target gained a value: %s", out)
	}
}

func TestRemapBranchTargetsToleratesEmptyConditions(t *testing.T) {
	for _, in := range [][]byte{nil, []byte(``), []byte(`{}`), []byte(`null`)} {
		out, err := RemapBranchTargets(in, nil)
		if err != nil {
			t.Fatalf("%q: %v", in, err)
		}
		if string(out) != `{}` {
			t.Errorf("%q -> %s, want {}", in, out)
		}
	}
}
