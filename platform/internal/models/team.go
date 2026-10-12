package models

import (
	"time"

	"github.com/google/uuid"
)

// Team is a named, colour-tagged grouping of an organization's members. Teams
// are always created from existing organization members; the Members slice is a
// joined hydration of the team_members junction and is only populated by reads
// that ask for it (e.g. ListTeams / GetTeam).
type Team struct {
	ID             uuid.UUID `json:"id"`
	OrganizationID uuid.UUID `json:"organization_id"`
	Name           string    `json:"name"`
	Color          string    `json:"color"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`

	// Joined data — the members that belong to this team. Always serialized as
	// an array (never null) so the frontend can iterate without guarding.
	Members []TeamMember `json:"members"`
}

// TeamMember is one membership row of a team. UserID is the junction key; Email
// and Name are joined from the users table for display convenience.
type TeamMember struct {
	UserID uuid.UUID `json:"user_id"`
	Email  string    `json:"email"`
	Name   string    `json:"name"`

	AddedAt time.Time `json:"added_at"`
}

// CreateTeam is the request body for creating a team. Color is optional; when
// omitted the table default (#94a3b8) applies.
type CreateTeam struct {
	Name  string `json:"name" binding:"required,min=1,max=255"`
	Color string `json:"color,omitempty"`
}

// UpdateTeam is the partial-update request body for a team. Nil fields are left
// untouched.
type UpdateTeam struct {
	Name  *string `json:"name,omitempty"`
	Color *string `json:"color,omitempty"`
}
