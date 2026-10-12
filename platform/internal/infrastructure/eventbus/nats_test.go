package eventbus

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	natsserver "github.com/nats-io/nats-server/v2/server"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/kafka"
)

// startEmbeddedNATS boots a JetStream-enabled NATS server on an ephemeral
// port using t.TempDir() for the store. The server is shut down via t.Cleanup.
func startEmbeddedNATS(t *testing.T) string {
	t.Helper()
	opts := &natsserver.Options{
		Host:      "127.0.0.1",
		Port:      -1, // pick a free port
		JetStream: true,
		StoreDir:  t.TempDir(),
		NoSigs:    true,
		NoLog:     true,
	}
	srv, err := natsserver.NewServer(opts)
	if err != nil {
		t.Skipf("could not start embedded nats-server: %v", err)
	}
	go srv.Start()
	if !srv.ReadyForConnections(5 * time.Second) {
		srv.Shutdown()
		t.Skip("embedded nats-server did not become ready in time")
	}
	t.Cleanup(func() {
		srv.Shutdown()
		srv.WaitForShutdown()
	})
	return srv.ClientURL()
}

func newTestNATSBus(t *testing.T) *NATSBus {
	t.Helper()
	url := startEmbeddedNATS(t)
	bus, err := NewNATS(NATSConfig{
		URL:           url,
		StreamName:    "pegasusbound-test",
		SubjectPrefix: "pegasusbound-test",
	})
	if err != nil {
		t.Fatalf("NewNATS: %v", err)
	}
	t.Cleanup(func() { _ = bus.Close() })
	return bus
}

func TestNATSBus_InterfaceSatisfaction(t *testing.T) {
	var _ EventBus = (*NATSBus)(nil)
}

func TestNATSBus_Name(t *testing.T) {
	bus := newTestNATSBus(t)
	if bus.Name() != "nats" {
		t.Fatalf("expected 'nats', got %q", bus.Name())
	}
}

// TestNATSBus_RoundTrip publishes on a worker-style topic and verifies a
// subscribed handler receives the same payload with the prefix stripped.
func TestNATSBus_RoundTrip(t *testing.T) {
	bus := newTestNATSBus(t)
	topic := kafka.GetWorkerTopic("22222222-2222-2222-2222-222222222222")
	payload := []byte("hello, pegasusbound")
	key := "task-1"

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		seen []Message
	)
	wg.Add(1)

	subErr := make(chan error, 1)
	go func() {
		subErr <- bus.Subscribe(ctx, []string{topic}, "test-group", func(_ context.Context, m Message) error {
			mu.Lock()
			seen = append(seen, m)
			n := len(seen)
			mu.Unlock()
			if n == 1 {
				wg.Done()
			}
			return nil
		})
	}()

	// Give the consumer a moment to register before publishing.
	time.Sleep(200 * time.Millisecond)

	if err := bus.Publish(ctx, topic, key, payload); err != nil {
		t.Fatalf("publish: %v", err)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for handler delivery")
	}

	cancel()
	if err := <-subErr; err != nil && !errors.Is(err, context.Canceled) {
		t.Fatalf("subscribe ended with: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(seen) == 0 {
		t.Fatal("handler never saw any message")
	}
	got := seen[0]
	// NATSBus reports topics in NATS-native form (dots, no prefix) — the
	// contract is "compare via Subject()", not "byte-equal the published
	// topic". See bus.go for the rationale.
	if got.Topic != Subject(topic) {
		t.Errorf("topic mismatch: got %q want %q", got.Topic, Subject(topic))
	}
	if got.Key != key {
		t.Errorf("key mismatch: got %q want %q", got.Key, key)
	}
	if string(got.Payload) != string(payload) {
		t.Errorf("payload mismatch: got %q want %q", got.Payload, payload)
	}
}

// TestNATSBus_HandlerErrorIsRedelivered confirms a handler returning an error
// causes JetStream to redeliver the same message.
func TestNATSBus_HandlerErrorIsRedelivered(t *testing.T) {
	bus := newTestNATSBus(t)
	topic := "jobs:redelivery"

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var attempts int
	done := make(chan struct{})
	subErr := make(chan error, 1)
	go func() {
		subErr <- bus.Subscribe(ctx, []string{topic}, "redeliver-group", func(_ context.Context, _ Message) error {
			attempts++
			if attempts == 1 {
				return errors.New("transient")
			}
			select {
			case <-done:
			default:
				close(done)
			}
			return nil
		})
	}()
	time.Sleep(200 * time.Millisecond)

	if err := bus.Publish(ctx, topic, "k", []byte("p")); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatalf("redelivery did not happen, attempts=%d", attempts)
	}
	if attempts < 2 {
		t.Fatalf("expected at least 2 attempts (one failed, one succeeded), got %d", attempts)
	}
	cancel()
	<-subErr
}

func TestNATSBus_SubscribeValidatesArgs(t *testing.T) {
	bus := newTestNATSBus(t)
	ctx := context.Background()
	cases := []struct {
		name    string
		topics  []string
		group   string
		handler Handler
	}{
		{"no topics", nil, "g", func(context.Context, Message) error { return nil }},
		{"no group", []string{"t"}, "", func(context.Context, Message) error { return nil }},
		{"no handler", []string{"t"}, "g", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := bus.Subscribe(ctx, tc.topics, tc.group, tc.handler); err == nil {
				t.Fatal("expected validation error, got nil")
			}
		})
	}
}

func TestNATSBus_NewNATSRejectsEmptyURL(t *testing.T) {
	_, err := NewNATS(NATSConfig{})
	if err == nil {
		t.Fatal("expected error when URL is empty")
	}
}

// TestNATSBus_DurableConsumerName guards the sanitisation rule — JetStream
// won't accept ":" or "/" in durable names.
func TestNATSBus_DurableConsumerName(t *testing.T) {
	bus := newTestNATSBus(t)
	got := bus.durable("worker-abc:def", []string{"w:11"})
	for _, r := range got {
		ok := (r >= 'a' && r <= 'z') ||
			(r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') ||
			r == '-' || r == '_'
		if !ok {
			t.Fatalf("durable name contains invalid rune %q in %q", r, got)
		}
	}
}

func TestFromEnv_DefaultsToKafka(t *testing.T) {
	t.Setenv("EVENTBUS_PROVIDER", "")
	// Missing bootstrap forces the kafka constructor to error, which is the
	// signal we use to confirm the kafka branch was taken without needing a
	// real broker.
	_, err := FromEnv("", nil)
	if err == nil {
		t.Fatal("expected kafka branch to error on missing bootstrap")
	}
}

func TestFromEnv_Nats(t *testing.T) {
	url := startEmbeddedNATS(t)
	t.Setenv("EVENTBUS_PROVIDER", "nats")
	t.Setenv("NATS_URL", url)
	t.Setenv("NATS_STREAM_NAME", "pegasusbound-fromenv")
	t.Setenv("NATS_SUBJECT_PREFIX", "pegasusbound-fromenv")

	bus, err := FromEnv("", nil)
	if err != nil {
		t.Fatalf("FromEnv: %v", err)
	}
	defer bus.Close()
	if bus.Name() != "nats" {
		t.Fatalf("expected nats bus, got %q", bus.Name())
	}
}

func TestFromEnv_UnknownProvider(t *testing.T) {
	t.Setenv("EVENTBUS_PROVIDER", "bogus")
	if _, err := FromEnv("", nil); err == nil {
		t.Fatal("expected error for unknown provider")
	}
}
