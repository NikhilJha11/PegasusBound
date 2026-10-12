package models

import "time"

// SendLifecycle is whether a mailbox is offered to cold sending.
//
// Orthogonal to EmailRiskBand: that decides which worker and IP host a
// mailbox, this decides whether it is in cold rotation at all. A resting
// mailbox is still a clean-band mailbox.
type SendLifecycle string

const (
	// SendLifecycleActive is in cold rotation. The default.
	SendLifecycleActive SendLifecycle = "active"
	// SendLifecycleResting was pulled out of cold rotation to recover on
	// warmup traffic alone, and returns on its own once it has.
	SendLifecycleResting SendLifecycle = "resting"
	// SendLifecycleReserve is held back deliberately by its owner. Never
	// entered or left automatically.
	SendLifecycleReserve SendLifecycle = "reserve"
)

// SendsCold reports whether cold sender resolution may offer this mailbox.
func (l SendLifecycle) SendsCold() bool {
	// An empty value is a row written before the column existed, which is
	// active: a mailbox must never stop sending because of a missing default.
	return l == SendLifecycleActive || l == ""
}

// AutoManaged reports whether the rebalancer may move this state. Reserve is
// the owner's decision and is never overridden.
func (l SendLifecycle) AutoManaged() bool {
	return l == SendLifecycleActive || l == SendLifecycleResting || l == ""
}

// Valid reports whether l is a state the database will accept.
func (l SendLifecycle) Valid() bool {
	switch l {
	case SendLifecycleActive, SendLifecycleResting, SendLifecycleReserve:
		return true
	}
	return false
}

// SendLifecycleState is a mailbox's lifecycle with its history.
type SendLifecycleState struct {
	State  SendLifecycle `json:"state"`
	Since  *time.Time    `json:"since,omitempty"`
	Reason string        `json:"reason,omitempty"`
}

// RestProbation is how long a rested mailbox must stay healthy before it is
// offered cold traffic again. Long enough that a mailbox does not bounce
// between states on one good hour.
const RestProbation = 72 * time.Hour

// RestingFor reports how long the mailbox has been resting, 0 if it is not.
func (s SendLifecycleState) RestingFor(now time.Time) time.Duration {
	if s.State != SendLifecycleResting || s.Since == nil {
		return 0
	}
	return now.Sub(*s.Since)
}

// ReadyToResume reports whether a resting mailbox has served its probation.
// Health is the caller's business; this only answers the clock.
func (s SendLifecycleState) ReadyToResume(now time.Time) bool {
	return s.State == SendLifecycleResting && s.RestingFor(now) >= RestProbation
}
