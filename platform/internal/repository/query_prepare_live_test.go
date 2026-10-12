package repository

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Every parameterised statement in this package must be preparable by Postgres.
// Skipped unless PEGASUSBOUND_TEST_DB is set:
//
//	PEGASUSBOUND_TEST_DB=postgres://pegasusbound:pegasusbound@localhost:15432/pegasusbound_dev?sslmode=disable \
//	  go test ./internal/repository/ -run TestLiveEveryQueryPrepares -v
//
// Issue #195: UpdateParticipantHealth used a bare $1 both as a health_state
// assignment and in equality tests. Postgres deduced `character varying` from
// one and `text` from the other, refused the statement with 42P08, and the
// query never ran — for any account, in any pool, since it was written. Nothing
// caught it because the error surfaced as a generic internal error at runtime
// and only on a code path nobody watched.
//
// A statement that cannot be prepared can never execute, so this is decidable
// ahead of time: ask the server. The same sweep found the identical defect in
// the contacts bulk custom-field writes and in the worker install-state update.
//
// Two classes fail the test. A parameter Postgres cannot type (42P08) is the
// original #195 defect. A reference to schema that does not exist (issue #209 —
// a renamed column, a table that was dropped, an enum value the type never had,
// a comparison between types with no operator) is the same kind of bug found
// the same way: six admin queries referenced a `plans.duration` column, a
// `user_rate_limits.daily_email_limit` column and a `campaign_status` value
// called 'stopped', none of which exist, and each failed 100% of the time.
//
// Syntax errors stay tolerated: the extractor below is a regex over source and
// will pick up the first fragment of a statement that is assembled at runtime.
const (
	indeterminateDatatype = "42P08" // a $n Postgres cannot assign a type to
	undefinedColumn       = "42703"
	undefinedTable        = "42P01"
	undefinedFunction     = "42883" // includes "operator does not exist"
	undefinedObject       = "42704"
	invalidTextRepr       = "22P02" // e.g. a literal that is not a value of an enum
)

// unrunnable is the set of SQLSTATEs that mean the statement can never execute,
// whatever the calling code looks like.
var unrunnable = map[string]string{
	indeterminateDatatype: "a parameter Postgres cannot type",
	undefinedColumn:       "a column that does not exist",
	undefinedTable:        "a table that does not exist",
	undefinedFunction:     "a function or operator that does not exist",
	undefinedObject:       "an object that does not exist",
	invalidTextRepr:       "a literal that is not a valid value of its type",
}

var (
	// A backtick string literal in Go source.
	rawLiteral = regexp.MustCompile("`([^`]*)`")
	// Something that starts like a complete statement.
	statementStart = regexp.MustCompile(`(?is)^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b`)
	// Placeholders. No placeholders means no parameter to be ambiguous about.
	hasParam = regexp.MustCompile(`\$\d`)
	// Assembled with fmt: not a statement, just a template.
	isTemplate = regexp.MustCompile(`%[sdvqt]`)
)

type extractedQuery struct {
	file string
	line int
	sql  string
}

func extractQueries(t *testing.T, dir string) []extractedQuery {
	t.Helper()

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}

	var out []extractedQuery
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		src, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		for _, m := range rawLiteral.FindAllSubmatchIndex(src, -1) {
			sql := string(src[m[2]:m[3]])
			if !hasParam.MatchString(sql) ||
				!statementStart.MatchString(sql) ||
				isTemplate.MatchString(sql) {
				continue
			}
			out = append(out, extractedQuery{
				file: name,
				line: strings.Count(string(src[:m[0]]), "\n") + 1,
				sql:  sql,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].file != out[j].file {
			return out[i].file < out[j].file
		}
		return out[i].line < out[j].line
	})
	return out
}

func TestLiveEveryQueryPrepares(t *testing.T) {
	dsn := os.Getenv("PEGASUSBOUND_TEST_DB")
	if dsn == "" {
		t.Skip("PEGASUSBOUND_TEST_DB not set")
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	queries := extractQueries(t, ".")
	if len(queries) < 100 {
		t.Fatalf("only found %d statements to check; the extractor is broken", len(queries))
	}

	var broken, other []string
	for i, q := range queries {
		_, err := conn.Prepare(ctx, fmt.Sprintf("check_%d", i), strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(q.sql), ";")))
		if err == nil {
			continue
		}

		where := fmt.Sprintf("%s:%d", q.file, q.line)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			if why, fatal := unrunnable[pgErr.Code]; fatal {
				broken = append(broken, fmt.Sprintf("%s: %s -- %s (%s)\n\t\t%s",
					where, why, pgErr.Message, pgErr.Code, oneLine(q.sql)))
				continue
			}
		}
		other = append(other, fmt.Sprintf("%s: %v", where, err))
	}

	// Informational: a fragment of a runtime-assembled statement lands here.
	if len(other) > 0 {
		t.Logf("%d statement(s) could not be prepared for other reasons (runtime-assembled fragments):\n%s",
			len(other), strings.Join(other, "\n"))
	}

	if len(broken) > 0 {
		t.Fatalf("%d statement(s) can never execute:\n%s",
			len(broken), strings.Join(broken, "\n"))
	}

	t.Logf("checked %d parameterised statements", len(queries))
}

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}
