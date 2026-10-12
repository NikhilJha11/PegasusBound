package team

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/pegasusbound/pegasusbound/internal/errx"
	"github.com/pegasusbound/pegasusbound/internal/models"
	"github.com/pegasusbound/pegasusbound/internal/repository"
)

// TeamService is the org-scoped CRUD surface for teams and their members. Teams
// are created from existing organization members; membership in the org is
// validated on AddMember.
type TeamService interface {
	ListTeams(ctx context.Context, orgID uuid.UUID) ([]models.Team, *errx.Error)
	GetTeam(ctx context.Context, orgID, teamID uuid.UUID) (*models.Team, *errx.Error)
	CreateTeam(ctx context.Context, orgID uuid.UUID, data *models.CreateTeam) (*models.Team, *errx.Error)
	UpdateTeam(ctx context.Context, orgID, teamID uuid.UUID, data *models.UpdateTeam) (*models.Team, *errx.Error)
	DeleteTeam(ctx context.Context, orgID, teamID uuid.UUID) *errx.Error

	AddMember(ctx context.Context, orgID, teamID, userID uuid.UUID) *errx.Error
	RemoveMember(ctx context.Context, orgID, teamID, userID uuid.UUID) *errx.Error
}

type teamService struct {
	repo repository.TeamRepository
}

// NewService builds the team service over its repository.
func NewService(repo repository.TeamRepository) TeamService {
	return &teamService{repo: repo}
}

func toErrx(err error) *errx.Error {
	if err == nil {
		return nil
	}
	var bizErr *errx.Error
	if errors.As(err, &bizErr) {
		return bizErr
	}
	return errx.InternalError()
}

func (s *teamService) ListTeams(ctx context.Context, orgID uuid.UUID) ([]models.Team, *errx.Error) {
	teams, err := s.repo.ListTeams(ctx, orgID)
	if err != nil {
		return nil, toErrx(err)
	}
	return teams, nil
}

func (s *teamService) GetTeam(ctx context.Context, orgID, teamID uuid.UUID) (*models.Team, *errx.Error) {
	team, err := s.repo.GetTeam(ctx, orgID, teamID)
	if err != nil {
		return nil, toErrx(err)
	}
	return team, nil
}

func (s *teamService) CreateTeam(ctx context.Context, orgID uuid.UUID, data *models.CreateTeam) (*models.Team, *errx.Error) {
	name := strings.TrimSpace(data.Name)
	if name == "" || len(name) > 255 {
		return nil, errx.New(errx.BadRequest, "team name must be between 1 and 255 characters")
	}
	data.Name = name

	team, err := s.repo.CreateTeam(ctx, orgID, data)
	if err != nil {
		return nil, toErrx(err)
	}
	return team, nil
}

func (s *teamService) UpdateTeam(ctx context.Context, orgID, teamID uuid.UUID, data *models.UpdateTeam) (*models.Team, *errx.Error) {
	if data.Name != nil {
		name := strings.TrimSpace(*data.Name)
		if name == "" || len(name) > 255 {
			return nil, errx.New(errx.BadRequest, "team name must be between 1 and 255 characters")
		}
		data.Name = &name
	}

	team, err := s.repo.UpdateTeam(ctx, orgID, teamID, data)
	if err != nil {
		return nil, toErrx(err)
	}
	return team, nil
}

func (s *teamService) DeleteTeam(ctx context.Context, orgID, teamID uuid.UUID) *errx.Error {
	if err := s.repo.DeleteTeam(ctx, orgID, teamID); err != nil {
		return toErrx(err)
	}
	return nil
}

func (s *teamService) AddMember(ctx context.Context, orgID, teamID, userID uuid.UUID) *errx.Error {
	// The repository validates that the user belongs to the org before the
	// junction insert; surface its typed error verbatim.
	if err := s.repo.AddMember(ctx, orgID, teamID, userID); err != nil {
		return toErrx(err)
	}
	return nil
}

func (s *teamService) RemoveMember(ctx context.Context, orgID, teamID, userID uuid.UUID) *errx.Error {
	if err := s.repo.RemoveMember(ctx, orgID, teamID, userID); err != nil {
		return toErrx(err)
	}
	return nil
}
