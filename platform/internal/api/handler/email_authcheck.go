package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/pegasusbound/pegasusbound/internal/api/middleware"
	"github.com/pegasusbound/pegasusbound/internal/errx"
)

// GetEmailAuthCheck validates SPF/DKIM/DMARC for a mailbox's sending domain on
// demand. Authentication alignment is a hard bulk-sender requirement and the
// most common silent deliverability failure, so this lets the user confirm
// their domain is set up correctly without leaving the dashboard.
//
// Read-only: it reports what DNS says right now and leaves the mailbox's stored
// auth_state alone. Use RefreshEmailAuthCheck to record the verdict.
func (h *Handler) GetEmailAuthCheck(c *gin.Context) {
	// The mailbox lookup is organization-scoped; a user id here 404s for everyone.
	orgID := middleware.GetOrganizationID(c)
	if orgID == nil {
		errx.JSON(c, errx.New(errx.BadRequest, "no organization selected"))
		return
	}

	res, xerr := h.EmailService.CheckDomainAuth(c.Request.Context(), orgID.String(), c.Param("id"))
	if xerr != nil {
		errx.JSON(c, xerr)
		return
	}

	c.JSON(http.StatusOK, res)
}

// RefreshEmailAuthCheck re-runs the check and PERSISTS the verdict for every
// active mailbox on the sending domain. This is how an owner who has just fixed
// their DNS clears the cold-send and warmup gate immediately instead of waiting
// for the background sweep to reach their domain.
//
// It is a separate write-scoped endpoint precisely because of that: the verdict
// decides whether a mailbox may send, so a read-scoped API key must not be able
// to change it. No Idempotency-Key: the write is derived entirely from public
// DNS with no caller input, so repeating it converges on the same row.
func (h *Handler) RefreshEmailAuthCheck(c *gin.Context) {
	orgID := middleware.GetOrganizationID(c)
	if orgID == nil {
		errx.JSON(c, errx.New(errx.BadRequest, "no organization selected"))
		return
	}

	res, xerr := h.EmailService.RefreshDomainAuth(c.Request.Context(), orgID.String(), c.Param("id"))
	if xerr != nil {
		errx.JSON(c, xerr)
		return
	}

	c.JSON(http.StatusOK, res)
}
