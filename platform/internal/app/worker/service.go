package worker

import (
	"context"
	"sync"

	"github.com/google/uuid"

	"github.com/pegasusbound/pegasusbound/internal/app/cipher"
	"github.com/pegasusbound/pegasusbound/internal/app/worker/mailmanager"
	"github.com/pegasusbound/pegasusbound/internal/config"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/cache"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/codec"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/eventbus"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/storage"
	"github.com/pegasusbound/pegasusbound/internal/models"
	"github.com/pegasusbound/pegasusbound/internal/repository"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type WorkerService struct {
	OnMailboxMissing          func()
	ID                        string
	CipherService             cipher.CipherService
	Bus                       eventbus.EventBus
	Codec                     codec.Codec
	QueueURL                  string
	Cache                     *cache.Cache
	Storage                   storage.Store
	EmailMessageMapRepository repository.EmailMessageMapRepository
	// SyncContextRepository answers the sync governor's priority-lane lookup
	// over the internal API. Optional: nil means every new message is live.
	SyncContextRepository repository.SyncContextRepository

	// OauthInbox supplies the provider OAuth configs (client id/secret +
	// endpoint) the worker needs to refresh delegated tokens locally. Cfg is not
	// serialized in the AddWorkerEmail payload, so the worker rebuilds it here.
	OauthInbox *config.Oauth2Inbox
	// TokenBroker serves mailboxes managed by Pegasusbound Cloud (brokered access
	// tokens over the internal API). Optional: nil refuses such mailboxes.
	TokenBroker repository.BrokeredTokenClient

	mailManager *mailmanager.MailManager
	// loads holds the mailboxes being loaded, so a republished ADD_EMAIL never dials twice.
	loads                  sync.Map // uuid.UUID -> *mailboxLoad
	pendingSendResults     sync.Map // uuid.UUID -> pendingSendResult
	pendingFilingDeferrals sync.Map // uuid.UUID -> models.WarmupFilingDeferralRequest

	// HealthCounters tracks the per-window send-side telemetry the worker
	// reports via JobEventTypeWorkerHealth. Lazily initialised by
	// ensureCounters so accessors are safe to call before RunHealth has
	// started.
	HealthCounters *HealthCounters
	healthOnce     sync.Once

	errorEvents   chan zapcore.Entry
	logger        *zap.Logger
	eventHandlers map[models.WorkerEventType]func(ctx context.Context, body any) error
}

func (s *WorkerService) Init() error {
	s.errorEvents = make(chan zapcore.Entry)
	var err error
	s.logger, err = NewLoggerWithHandler(s.HandleError)
	if err != nil {
		return err
	}

	s.mailManager = mailmanager.NewMailManager(
		s.Produce,
		s.Cache,
		s.Storage,
		s.EmailMessageMapRepository,
		s.SyncContextRepository,
		s.CipherService,
		s.OauthInbox,
	)
	if s.TokenBroker != nil {
		s.mailManager.WireTokenBroker(s.TokenBroker)
	}
	s.mailManager.ExecutorID, _ = uuid.Parse(s.ID)

	return nil
}
