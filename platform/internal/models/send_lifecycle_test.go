package models

import (
	"testing"
	"time"
)

func TestSendsCold(t *testing.T) {
	if !SendLifecycleActive.SendsCold() {
		t.Error("active must send cold")
	}
	// A row written before the column existed reads as empty. Treating that as
	// "not sending" would silently stop every existing mailbox on deploy.
	if !SendLifecycle("").SendsCold() {
		t.Error("an unset lifecycle must send cold")
	}
	for _, l := range []SendLifecycle{SendLifecycleResting, SendLifecycleReserve} {
		if l.SendsCold() {
			t.Errorf("%q must not be offered cold traffic", l)
		}
	}
}

func TestAutoManaged(t *testing.T) {
	// Reserve is the owner's decision; the rebalancer must never take a
	// mailbox out of it.
	if SendLifecycleReserve.AutoManaged() {
		t.Error("reserve must not be automatically managed")
	}
	for _, l := range []SendLifecycle{SendLifecycleActive, SendLifecycleResting, ""} {
		if !l.AutoManaged() {
			t.Errorf("%q should be automatically managed", l)
		}
	}
}

func TestReadyToResume(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	since := now.Add(-RestProbation)

	rested := SendLifecycleState{State: SendLifecycleResting, Since: &since}
	if !rested.ReadyToResume(now) {
		t.Error("a mailbox that served its full probation should be ready")
	}

	fresh := now.Add(-time.Hour)
	if (SendLifecycleState{State: SendLifecycleResting, Since: &fresh}).ReadyToResume(now) {
		t.Error("an hour of rest is not a probation")
	}
	// No timestamp means nothing to measure, so it is not ready: promoting on a
	// missing clock would defeat the probation entirely.
	if (SendLifecycleState{State: SendLifecycleResting}).ReadyToResume(now) {
		t.Error("a resting mailbox with no start time must not resume")
	}
	if (SendLifecycleState{State: SendLifecycleActive, Since: &since}).ReadyToResume(now) {
		t.Error("only a resting mailbox resumes")
	}
}

func TestValid(t *testing.T) {
	for _, l := range []SendLifecycle{SendLifecycleActive, SendLifecycleResting, SendLifecycleReserve} {
		if !l.Valid() {
			t.Errorf("%q should be valid", l)
		}
	}
	for _, l := range []SendLifecycle{"", "warming", "paused", "nonsense"} {
		if l.Valid() {
			t.Errorf("%q should not be valid", l)
		}
	}
}
