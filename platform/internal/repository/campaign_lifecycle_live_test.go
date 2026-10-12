package repository

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pegasusbound/pegasusbound/internal/errx"
	"github.com/pegasusbound/pegasusbound/internal/models"
)

// Issue #185: delete and duplicate a campaign from the dashboard. Duplicate
// must copy configuration (steps with their branch graph, senders, variants,
// advanced settings, attachments) and nothing of the execution state; delete
// must take the campaign's pending tasks with it so nothing keeps firing.
//
// Run against the dev stack:
//
//	PEGASUSBOUND_TEST_DB=postgres://pegasusbound:pegasusbound@localhost:15432/pegasusbound_dev?sslmode=disable \
//	  go test ./internal/repository/ -run LiveCampaignLifecycle -v

type lifecycleFixture struct {
	org, owner, mate, mailbox, campaign, contact uuid.UUID
	steps                                        [3]uuid.UUID
	pendingTask, sentTask, claimedTask           uuid.UUID
}

func newLifecycleFixture(t *testing.T, pool *pgxpool.Pool) *lifecycleFixture {
	t.Helper()
	ctx := context.Background()
	f := &lifecycleFixture{
		org: uuid.New(), owner: uuid.New(), mate: uuid.New(), mailbox: uuid.New(),
		campaign: uuid.New(), contact: uuid.New(),
		steps:       [3]uuid.UUID{uuid.New(), uuid.New(), uuid.New()},
		pendingTask: uuid.New(), sentTask: uuid.New(), claimedTask: uuid.New(),
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("fixture %q: %v", sql[:min(70, len(sql))], err)
		}
	}

	for _, u := range []struct {
		id   uuid.UUID
		name string
	}{{f.owner, "Owner"}, {f.mate, "Mate"}} {
		exec(`INSERT INTO users (id, first_name, last_name, email, password_hash)
		      VALUES ($1, $2, 'Live', $3, 'x')`, u.id, u.name, "i185-"+u.id.String()[:8]+"@test.local")
	}
	exec(`INSERT INTO organizations (id, name, slug, owner_user_id) VALUES ($1, 'Issue 185', $2, $3)`,
		f.org, "i185-"+f.org.String()[:8], f.owner)
	exec(`INSERT INTO organization_members (organization_id, user_id, role, accepted_at)
	      VALUES ($1, $2, 'owner', NOW()), ($1, $3, 'admin', NOW())`, f.org, f.owner, f.mate)
	exec(`INSERT INTO email_accounts (id, user_id, organization_id, email, name,
	          signature_plain, signature_html, provider, status, campaign_limit, min_wait_time, timezone)
	      VALUES ($1, $2, $3, $4, 'Live', '', '', 'smtp_imap', 'active', 50, 600, 'UTC')`,
		f.mailbox, f.owner, f.org, "i185-"+f.mailbox.String()[:8]+"@test.local")

	// A running campaign with history: ramped, guardrail-tripped, dated in the
	// past, with a schedule and a tracking domain.
	exec(`INSERT INTO campaigns (id, user_id, organization_id, name, description, status, days,
	          daily_limit, start_date, end_date, schedule_windows, sender_strategy,
	          ramp_enabled, ramp_level, ramp_level_date, guardrail_enabled, guardrail_tripped_at, guardrail_reason,
	          tracking_domain, tracking_domain_verified, last_status_change_at, updated_at, created_at)
	      VALUES ($1, $2, $3, 'Agency partnerships', 'Warm intros', 'active', 62,
	          40, NOW() - INTERVAL '30 days', NOW() - INTERVAL '1 day',
	          '[[],[{"start":540,"end":1020}],[],[],[],[],[]]'::jsonb, 'explicit',
	          true, 3, CURRENT_DATE, true, NOW(), 'bounce rate 7%',
	          't.example.test', true, NOW(), NOW(), NOW())`,
		f.campaign, f.owner, f.org)

	// Three steps: 1 branches to 2 (replied) or 3 (otherwise), 2 flows to 3,
	// 3 points at a step that no longer exists.
	gone := uuid.New()
	for i, s := range []struct {
		id         uuid.UUID
		conditions string
		kind       string
	}{
		{f.steps[0], `{"branches":[{"branch_id":"b1","target_step_id":"` + f.steps[1].String() + `","conditions":[{"field":"replied","operator":"is_true"}],"instant":true},{"branch_id":"b2","target_step_id":"` + f.steps[2].String() + `"}]}`, "email"},
		{f.steps[1], `{"branches":[{"branch_id":"b3","target_step_id":"` + f.steps[2].String() + `"}]}`, "email"},
		{f.steps[2], `{"branches":[{"branch_id":"b4","target_step_id":"` + gone.String() + `"}]}`, "action"},
	} {
		exec(`INSERT INTO sequences (id, campaign_id, organization_id, name, subject, body_plain, body_html,
		          wait_after, position, conditions, kind, action, x, y)
		      VALUES ($1, $2, $3, $4, 'Hi {{first_name}}', 'plain', '<p>html</p>', $5, $6, $7::jsonb, $8, '{"type":"add_tag"}'::jsonb, $9, 20)`,
			s.id, f.campaign, f.org, "Step "+string(rune('1'+i)), i*3, i+1, s.conditions, s.kind, float64(i*100))
	}
	exec(`INSERT INTO campaign_senders (campaign_id, email_account_id, weight, enabled, rotation_position, last_sent_at)
	      VALUES ($1, $2, 7, true, 4, NOW())`, f.campaign, f.mailbox)
	exec(`INSERT INTO campaign_ab_variants (campaign_id, sequence_id, name, weight, subject, is_control)
	      VALUES ($1, $2, 'Subject B', 50, 'Quick question', false)`, f.campaign, f.steps[0])
	exec(`INSERT INTO campaign_advanced_settings (campaign_id, settings) VALUES ($1, '{"bounce_policy":"strict"}'::jsonb)`, f.campaign)

	// Execution state that must not travel.
	exec(`INSERT INTO contacts (id, user_id, organization_id, email, first_name, last_name, company, phone, custom_fields, updated_at, created_at)
	      VALUES ($1, $2, $3, $4, 'Carlos', 'Diaz', 'Pied Piper', '', '{}'::jsonb, NOW(), NOW())`,
		f.contact, f.owner, f.org, "i185-"+f.contact.String()[:8]+"@test.local")
	exec(`INSERT INTO campaign_leads (campaign_id, contact_id) VALUES ($1, $2)`, f.campaign, f.contact)
	exec(`INSERT INTO campaign_contact_progress (campaign_id, contact_id, sequence_id, sent_at) VALUES ($1, $2, $3, NOW())`,
		f.campaign, f.contact, f.steps[0])
	exec(`INSERT INTO campaign_logs (campaign_id, event_type, message) VALUES ($1, 'started', 'Campaign started by user')`, f.campaign)
	exec(`INSERT INTO tasks (id, task_type, email_account_id, status, message_id, scheduled_at)
	      VALUES ($1, 'campaign', $2, 'pending', '', NOW() + INTERVAL '1 hour'),
	             ($3, 'email', $2, 'completed', '<sent@test.local>', NOW() - INTERVAL '1 hour'),
	             ($4, 'campaign', $2, 'active', '', NOW())`,
		f.pendingTask, f.mailbox, f.sentTask, f.claimedTask)
	exec(`INSERT INTO campaign_tasks (task_id, campaign_id) VALUES ($1, $2), ($3, $2)`, f.pendingTask, f.campaign, f.claimedTask)
	exec(`INSERT INTO campaign_tasks (task_id, campaign_id, contact_id, sequence_id) VALUES ($1, $2, $3, $4)`,
		f.sentTask, f.campaign, f.contact, f.steps[0])

	t.Cleanup(func() {
		c := context.Background()
		for _, step := range []struct {
			sql string
			arg any
		}{
			{`DELETE FROM campaigns WHERE organization_id = $1`, f.org},
			{`DELETE FROM tasks WHERE id = ANY($1)`, []uuid.UUID{f.pendingTask, f.sentTask, f.claimedTask}},
			{`DELETE FROM contacts WHERE organization_id = $1`, f.org},
			{`DELETE FROM email_accounts WHERE organization_id = $1`, f.org},
			{`DELETE FROM organization_members WHERE organization_id = $1`, f.org},
			{`DELETE FROM organizations WHERE id = $1`, f.org},
			{`DELETE FROM users WHERE id = ANY($1)`, []uuid.UUID{f.owner, f.mate}},
		} {
			if _, err := pool.Exec(c, step.sql, step.arg); err != nil {
				t.Errorf("cleanup %q: %v", step.sql, err)
			}
		}
	})
	return f
}

func countRows(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count %q: %v", sql, err)
	}
	return n
}

func TestLiveCampaignLifecycleDuplicateCopiesConfigurationOnly(t *testing.T) {
	handle, pool := liveContactDB(t)
	f := newLifecycleFixture(t, pool)
	repo := NewCampaignRepostory(handle)
	ctx := context.Background()

	newID := uuid.New()
	dup, err := repo.Duplicate(ctx, DuplicateCampaignInput{
		SourceID: f.campaign,
		NewID:    newID,
		UserID:   f.mate,
		Name:     "Agency partnerships (copy)",
		Attachments: []models.CampaignAttachment{{
			SequenceID: &f.steps[0], UserID: f.owner, Filename: "deck.pdf", Size: 1234,
			MimeType: "application/pdf", S3Key: "attachments/" + newID.String() + "/deck.pdf",
		}},
	})
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}

	// Campaign row: configuration copied, execution state reset.
	if dup.ID != newID || dup.Name != "Agency partnerships (copy)" || dup.Status != "draft" {
		t.Fatalf("dup = %s %q %s, want %s / (copy) / draft", dup.ID, dup.Name, dup.Status, newID)
	}
	if dup.UserID != f.mate.String() || dup.OrganizationID == nil || *dup.OrganizationID != f.org {
		t.Errorf("owner = %s org = %v, want mate %s in org %s", dup.UserID, dup.OrganizationID, f.mate, f.org)
	}
	if dup.Description != "Warm intros" || dup.DailyLimit != 40 || dup.SenderStrategy != "explicit" || !dup.RampEnabled {
		t.Errorf("configuration not copied: %+v", dup)
	}
	if dup.TrackingDomain != "t.example.test" || !dup.TrackingDomainVerified {
		t.Errorf("tracking domain not copied: %q verified=%v", dup.TrackingDomain, dup.TrackingDomainVerified)
	}
	if dup.ScheduleWindows.IsEmpty() {
		t.Errorf("schedule windows not copied")
	}
	if dup.RampLevel != 0 || dup.RampLevelDate != nil {
		t.Errorf("ramp level travelled: %d %v", dup.RampLevel, dup.RampLevelDate)
	}
	if dup.GuardrailTrippedAt != nil || dup.GuardrailReason != "" || !dup.GuardrailEnabled {
		t.Errorf("guardrail trip travelled or config lost: %v %q %v", dup.GuardrailTrippedAt, dup.GuardrailReason, dup.GuardrailEnabled)
	}
	if dup.StartDate != nil || dup.EndDate != nil {
		t.Errorf("past dates should be dropped: start=%v end=%v", dup.StartDate, dup.EndDate)
	}
	if dup.LastStatusChangeAt != nil {
		t.Errorf("last_status_change_at travelled: %v", dup.LastStatusChangeAt)
	}
	if len(dup.Senders) != 1 || dup.Senders[0].EmailAccountID != f.mailbox || dup.Senders[0].Weight != 7 {
		t.Errorf("senders = %+v, want the one explicit mailbox with weight 7", dup.Senders)
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM campaign_senders WHERE campaign_id = $1 AND rotation_position = 0 AND last_sent_at IS NULL`, newID); n != 1 {
		t.Errorf("sender rotation cursor should reset, matching rows = %d", n)
	}

	// Steps: same shape, fresh ids, branch graph rewired onto the copies.
	steps, err := repo.GetSequencesRoutingByCampaignID(ctx, newID)
	if err != nil {
		t.Fatalf("steps: %v", err)
	}
	if len(steps) != 3 {
		t.Fatalf("steps = %d, want 3", len(steps))
	}
	idMap := map[uuid.UUID]uuid.UUID{}
	for i, s := range steps {
		if s.Position != i+1 {
			t.Errorf("step %d position = %d", i, s.Position)
		}
		for _, old := range f.steps {
			if s.ID == old {
				t.Errorf("step %d kept the source id %s", i, old)
			}
		}
		idMap[f.steps[i]] = s.ID
	}
	branchTargets := func(s models.Sequence) []*uuid.UUID {
		var bc models.BranchConditions
		if err := json.Unmarshal(s.Conditions, &bc); err != nil {
			t.Fatalf("conditions of %s: %v", s.ID, err)
		}
		out := make([]*uuid.UUID, 0, len(bc.Branches))
		for _, b := range bc.Branches {
			out = append(out, b.TargetSequenceID)
		}
		return out
	}
	if got := branchTargets(steps[0]); len(got) != 2 || got[0] == nil || *got[0] != idMap[f.steps[1]] || got[1] == nil || *got[1] != idMap[f.steps[2]] {
		t.Errorf("step 1 branches = %v, want [%s %s]", got, idMap[f.steps[1]], idMap[f.steps[2]])
	}
	if got := branchTargets(steps[1]); len(got) != 1 || got[0] == nil || *got[0] != idMap[f.steps[2]] {
		t.Errorf("step 2 branches = %v, want [%s]", got, idMap[f.steps[2]])
	}
	if got := branchTargets(steps[2]); len(got) != 1 || got[0] != nil {
		t.Errorf("step 3 dangling branch = %v, want [nil]", got)
	}
	if steps[2].Kind != "action" {
		t.Errorf("step kind not copied: %q", steps[2].Kind)
	}

	// Children: variant and attachment follow their step; settings copied.
	if n := countRows(t, pool, `SELECT COUNT(*) FROM campaign_ab_variants WHERE campaign_id = $1 AND sequence_id = $2 AND name = 'Subject B'`, newID, idMap[f.steps[0]]); n != 1 {
		t.Errorf("variant rows on the copied step = %d, want 1", n)
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM campaign_attachments WHERE campaign_id = $1 AND sequence_id = $2 AND user_id = $3 AND s3_key LIKE 'attachments/' || $1::text || '/%'`, newID, idMap[f.steps[0]], f.mate); n != 1 {
		t.Errorf("attachment rows on the copied step = %d, want 1", n)
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM campaign_advanced_settings WHERE campaign_id = $1 AND settings->>'bounce_policy' = 'strict'`, newID); n != 1 {
		t.Errorf("advanced settings rows = %d, want 1", n)
	}

	// Execution state stays behind.
	for _, q := range []string{
		`SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = $1`,
		`SELECT COUNT(*) FROM campaign_contact_progress WHERE campaign_id = $1`,
		`SELECT COUNT(*) FROM campaign_logs WHERE campaign_id = $1`,
		`SELECT COUNT(*) FROM campaign_tasks WHERE campaign_id = $1`,
		`SELECT COUNT(*) FROM campaign_daily_sends WHERE campaign_id = $1`,
	} {
		if n := countRows(t, pool, q, newID); n != 0 {
			t.Errorf("%s = %d for the copy, want 0", q, n)
		}
	}

	// The source is untouched.
	src, err := repo.GetByID(ctx, f.campaign)
	if err != nil {
		t.Fatalf("source: %v", err)
	}
	if src.Status != "active" || src.RampLevel != 3 || src.GuardrailReason != "bounce rate 7%" || src.EndDate == nil {
		t.Errorf("source changed: %+v", src)
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM sequences WHERE campaign_id = $1 AND id = ANY($2)`, f.campaign, f.steps[:]); n != 3 {
		t.Errorf("source steps = %d, want 3", n)
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = $1`, f.campaign); n != 1 {
		t.Errorf("source leads = %d, want 1", n)
	}
}

func TestLiveCampaignLifecycleDeleteCancelsPendingTasksAndKeepsSentMail(t *testing.T) {
	handle, pool := liveContactDB(t)
	f := newLifecycleFixture(t, pool)
	repo := NewCampaignRepostory(handle)
	ctx := context.Background()

	if err := repo.Delete(ctx, f.campaign); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM campaigns WHERE id = $1`, f.campaign); n != 0 {
		t.Fatalf("campaign still present")
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM tasks WHERE id = $1`, f.pendingTask); n != 0 {
		t.Errorf("pending campaign task survived the delete and would fire")
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM tasks WHERE id = $1 AND status = 'cancelled'`, f.claimedTask); n != 1 {
		t.Errorf("a wakeup tick claimed at delete time should be marked cancelled, not left active")
	}
	// The completed send stays: it backs the mail already in the inbox, only
	// its campaign link is cleared.
	if n := countRows(t, pool, `SELECT COUNT(*) FROM tasks t JOIN campaign_tasks ct ON ct.task_id = t.id WHERE t.id = $1 AND ct.campaign_id IS NULL`, f.sentTask); n != 1 {
		t.Errorf("completed send task should remain with a null campaign link")
	}
	for _, q := range []string{
		`SELECT COUNT(*) FROM sequences WHERE campaign_id = $1`,
		`SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = $1`,
		`SELECT COUNT(*) FROM campaign_contact_progress WHERE campaign_id = $1`,
		`SELECT COUNT(*) FROM campaign_logs WHERE campaign_id = $1`,
		`SELECT COUNT(*) FROM campaign_senders WHERE campaign_id = $1`,
		`SELECT COUNT(*) FROM campaign_ab_variants WHERE campaign_id = $1`,
		`SELECT COUNT(*) FROM campaign_advanced_settings WHERE campaign_id = $1`,
	} {
		if n := countRows(t, pool, q, f.campaign); n != 0 {
			t.Errorf("%s = %d after delete, want 0", q, n)
		}
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM contacts WHERE id = $1`, f.contact); n != 1 {
		t.Errorf("deleting a campaign must not delete its contacts")
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM email_accounts WHERE id = $1`, f.mailbox); n != 1 {
		t.Errorf("deleting a campaign must not delete its mailboxes")
	}

	if err := repo.Delete(ctx, f.campaign); !errors.Is(err, errx.ErrResourceNotFound) {
		t.Errorf("second delete = %v, want ErrResourceNotFound", err)
	}
	if err := repo.Delete(ctx, uuid.New()); !errors.Is(err, errx.ErrResourceNotFound) {
		t.Errorf("delete unknown = %v, want ErrResourceNotFound", err)
	}
}
