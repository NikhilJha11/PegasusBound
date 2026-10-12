package models

// Pagination is the keyset list envelope. NextCursor is an OPAQUE token (see
// internal/utils/cursor), not a raw record id, so clients cannot couple to the
// cursor's internal format. A nil NextCursor means there is no next page.
type Pagination struct {
	Total      *int64  `json:"total"`
	NextCursor *string `json:"next_cursor"`
	HasMore    bool    `json:"has_more"`
}

type CPagination struct {
	NextCursor *string `json:"next_cursor"`
	HasMore    bool    `json:"has_more"`
}
