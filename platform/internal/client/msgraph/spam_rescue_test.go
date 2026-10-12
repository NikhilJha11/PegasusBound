package msgraph

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

// stubRT answers Graph calls from a canned table and records what was asked.
type stubRT struct {
	body  map[string]string // match on URL fragment -> JSON response
	calls []string
}

func (s *stubRT) RoundTrip(req *http.Request) (*http.Response, error) {
	s.calls = append(s.calls, req.Method+" "+req.URL.Path)
	for frag, body := range s.body {
		if strings.Contains(req.URL.String(), frag) {
			return &http.Response{
				StatusCode: 200,
				Body:       io.NopCloser(strings.NewReader(body)),
				Header:     http.Header{"Content-Type": []string{"application/json"}},
			}, nil
		}
	}
	return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader(`{}`))}, nil
}

func newStubClient(rt *stubRT) *Client {
	return &Client{hc: &http.Client{Transport: rt}, folderIDs: map[string]string{}}
}

func (s *stubRT) moved() bool {
	for _, c := range s.calls {
		if strings.HasSuffix(c, "/move") {
			return true
		}
	}
	return false
}

// A message sitting in Junk is what the rescue exists for: it must move.
func TestRemoveFromSpamMovesAMessageThatIsInJunk(t *testing.T) {
	rt := &stubRT{body: map[string]string{
		"/mailFolders/junkemail": `{"id":"JUNK_ID"}`,
		"parentFolderId":         `{"parentFolderId":"JUNK_ID"}`,
		"/move":                  `{"id":"NEW_ID"}`,
	}}
	newID, err := newStubClient(rt).RemoveFromSpam(context.Background(), "MSG")
	if err != nil {
		t.Fatalf("RemoveFromSpam: %v", err)
	}
	if !rt.moved() {
		t.Error("a message in Junk must be moved to the Inbox")
	}
	if newID != "NEW_ID" {
		t.Errorf("new id = %q, want NEW_ID", newID)
	}
}

// The regression: engagementPlan folders into Pegasusbound first, so the rescue
// usually runs against a message that is no longer in Junk. Moving it then
// undoes the foldering and re-admits it to the tracked Inbox under a new id.
func TestRemoveFromSpamLeavesAMessageThatIsNotInJunk(t *testing.T) {
	rt := &stubRT{body: map[string]string{
		"/mailFolders/junkemail": `{"id":"JUNK_ID"}`,
		"parentFolderId":         `{"parentFolderId":"PEGASUSBOUND_ID"}`,
		"/move":                  `{"id":"NEW_ID"}`,
	}}
	newID, err := newStubClient(rt).RemoveFromSpam(context.Background(), "MSG")
	if err != nil {
		t.Fatalf("RemoveFromSpam: %v", err)
	}
	if rt.moved() {
		t.Error("a message outside Junk must not be moved: that undoes the Pegasusbound foldering")
	}
	if newID != "" {
		t.Errorf("new id = %q, want empty (nothing moved)", newID)
	}
}

// The well-known folder id is resolved once and cached, not re-fetched per call.
func TestWellKnownFolderIDIsCached(t *testing.T) {
	rt := &stubRT{body: map[string]string{"/mailFolders/junkemail": `{"id":"JUNK_ID"}`}}
	c := newStubClient(rt)
	for i := 0; i < 3; i++ {
		if _, err := c.wellKnownFolderID(context.Background(), FolderJunk); err != nil {
			t.Fatal(err)
		}
	}
	n := 0
	for _, call := range rt.calls {
		if strings.Contains(call, "junkemail") {
			n++
		}
	}
	if n != 1 {
		t.Errorf("junk folder resolved %d times, want 1 (cached)", n)
	}
}
