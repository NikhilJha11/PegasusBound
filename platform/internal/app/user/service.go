package user

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/pegasusbound/pegasusbound/internal/errx"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/cache"
	"github.com/pegasusbound/pegasusbound/internal/models"
	"github.com/pegasusbound/pegasusbound/internal/repository"
)

type UserService interface {
	SaveUser(ctx context.Context, user *models.User) *errx.Error
	GetUser(ctx context.Context, userID uuid.UUID) (*models.User, *errx.Error)
	CompleteOnboarding(ctx context.Context, userID uuid.UUID, firstName, lastName, referralSource, role, teamSize string) *errx.Error
	UpdateProfile(ctx context.Context, userID uuid.UUID, firstName, lastName string) *errx.Error
	UpdateUndoSendSeconds(ctx context.Context, userID uuid.UUID, seconds int) *errx.Error
	CompleteProductTour(ctx context.Context, userID uuid.UUID) (time.Time, *errx.Error)
	UpdateAvatar(ctx context.Context, userID uuid.UUID, avatarURL *string) *errx.Error
}

type userService struct {
	cache          *cache.Cache
	userRepository repository.UserRepository
}

func NewService(userRepository repository.UserRepository, cache *cache.Cache) UserService {
	return &userService{
		userRepository: userRepository,
		cache:          cache,
	}
}
