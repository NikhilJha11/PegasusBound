package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pegasusbound/pegasusbound/internal/models"
)

// activityWriter is the slice of pgx.Tx the lifecycle loggers need, so they
// run inside the mutation's own transaction and a rolled-back link never
// leaves a stray "added to campaign" event behind.
type activityWriter interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// contactLink is one (contact, campaign-or-category) membership change.
type contactLink struct {
	ContactID uuid.UUID
	LinkID    uuid.UUID
}

// actorID turns the caller id the repository receives into the nullable
// users reference contact_activities stores.
func actorID(userID string) *uuid.UUID {
	id, err := uuid.Parse(userID)
	if err != nil {
		return nil
	}
	return &id
}

// logContactCreated records the contact_created lifecycle event for freshly
// inserted rows, carrying the first-touch source they were stamped with.
func logContactCreated(ctx context.Context, tx activityWriter, orgID uuid.UUID, userID *uuid.UUID, contactIDs []uuid.UUID) error {
	if len(contactIDs) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO contact_activities (contact_id, organization_id, user_id, activity_type, metadata)
		SELECT c.id, $1, $2, 'contact_created',
		       jsonb_build_object('source', c.source, 'source_detail', c.source_detail)
		FROM   contacts c
		WHERE  c.id = ANY($3) AND c.organization_id = $1
	`, orgID, userID, contactIDs)
	return err
}

// logCampaignLinks records campaign_added / campaign_removed events, resolving
// the campaign name at write time so the timeline survives a later rename or
// deletion of the campaign.
func logCampaignLinks(ctx context.Context, tx activityWriter, orgID uuid.UUID, userID *uuid.UUID, typ models.ActivityType, links []contactLink) error {
	if len(links) == 0 {
		return nil
	}
	contacts, targets := splitLinks(links)
	_, err := tx.Exec(ctx, `
		INSERT INTO contact_activities (contact_id, organization_id, user_id, activity_type, metadata)
		SELECT l.contact_id, $1, $2, $3::activity_type,
		       jsonb_build_object('campaign_id', cam.id, 'campaign_name', cam.name)
		FROM   unnest($4::uuid[], $5::uuid[]) AS l(contact_id, campaign_id)
		JOIN   campaigns cam ON cam.id = l.campaign_id
	`, orgID, userID, string(typ), contacts, targets)
	return err
}

// logCategoryLinks is the category twin of logCampaignLinks.
func logCategoryLinks(ctx context.Context, tx activityWriter, orgID uuid.UUID, userID *uuid.UUID, typ models.ActivityType, links []contactLink) error {
	if len(links) == 0 {
		return nil
	}
	contacts, targets := splitLinks(links)
	_, err := tx.Exec(ctx, `
		INSERT INTO contact_activities (contact_id, organization_id, user_id, activity_type, metadata)
		SELECT l.contact_id, $1, $2, $3::activity_type,
		       jsonb_build_object('category_id', cat.id, 'category_title', cat.title)
		FROM   unnest($4::uuid[], $5::uuid[]) AS l(contact_id, category_id)
		JOIN   categories cat ON cat.id = l.category_id
	`, orgID, userID, string(typ), contacts, targets)
	return err
}

func splitLinks(links []contactLink) ([]uuid.UUID, []uuid.UUID) {
	contacts := make([]uuid.UUID, len(links))
	targets := make([]uuid.UUID, len(links))
	for i, l := range links {
		contacts[i] = l.ContactID
		targets[i] = l.LinkID
	}
	return contacts, targets
}

// collectLinks drains a RETURNING (id) result into links for one contact.
func collectLinks(rows interface {
	Next() bool
	Scan(dest ...any) error
	Close()
	Err() error
}, contactID uuid.UUID) ([]contactLink, error) {
	defer rows.Close()
	var out []contactLink
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, contactLink{ContactID: contactID, LinkID: id})
	}
	return out, rows.Err()
}

// collectLinkPairs drains a RETURNING (contact_id, id) result.
func collectLinkPairs(rows interface {
	Next() bool
	Scan(dest ...any) error
	Close()
	Err() error
}) ([]contactLink, error) {
	defer rows.Close()
	var out []contactLink
	for rows.Next() {
		var l contactLink
		if err := rows.Scan(&l.ContactID, &l.LinkID); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}
