package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// InternalGetTrackedLink resolves a click ticket for the tracking service.
// Auth via middleware.InternalAuthMiddleware (INTERNAL_API_TOKEN, both sides).
//
//	GET /api/v1/internal/tracked-links/:id
//	  -> 200 {"destination":"https://...","task_id":"<uuid>","identify":bool} | 404
//
// identify is true when the workspace runs website tracking and registered
// the destination's host, so the redirect may append the ticket for the
// snippet to tie the browser to the contact.
//
// The tracking service caches positives and negatives aggressively and rate
// limits miss-heavy sources before calling here, so this stays a cheap
// primary-key read even under probing.
func (h *Handler) InternalGetTrackedLink(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	link, lerr := h.TrackedLinks.GetByID(c.Request.Context(), id)
	if lerr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "lookup failed"})
		return
	}
	if link == nil {
		c.Status(http.StatusNotFound)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"destination": link.Destination,
		"task_id":     link.TaskID.String(),
		"identify":    h.websiteIdentifyForLink(c, link.CampaignID, link.Destination),
	})
}
