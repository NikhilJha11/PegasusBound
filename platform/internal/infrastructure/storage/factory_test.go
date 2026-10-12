package storage

import (
	"context"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
)

func TestNewFromEnv_UnknownProvider(t *testing.T) {
	t.Setenv("BLOB_PROVIDER", "garage-but-not-really")
	_, err := NewFromEnv(context.Background(), aws.Config{}, "")
	if err == nil {
		t.Fatal("expected error for unknown provider")
	}
}

func TestNewFromEnv_FilesystemNeedsRoot(t *testing.T) {
	t.Setenv("BLOB_PROVIDER", "filesystem")
	t.Setenv("BLOB_FS_ROOT", "")
	if _, err := NewFromEnv(context.Background(), aws.Config{}, ""); err == nil {
		t.Fatal("filesystem provider should require BLOB_FS_ROOT")
	}
}

func TestNewFromEnv_FilesystemHappy(t *testing.T) {
	t.Setenv("BLOB_PROVIDER", "filesystem")
	t.Setenv("BLOB_FS_ROOT", t.TempDir())
	s, err := NewFromEnv(context.Background(), aws.Config{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if s.Name() != "filesystem" {
		t.Fatalf("expected filesystem, got %q", s.Name())
	}
}

func TestNewFromEnv_S3NeedsBucket(t *testing.T) {
	t.Setenv("BLOB_PROVIDER", "s3")
	t.Setenv("BLOB_BUCKET", "")
	if _, err := NewFromEnv(context.Background(), aws.Config{}, ""); err == nil {
		t.Fatal("s3 provider should require BLOB_BUCKET or fallback bucket")
	}
}

func TestNewFromEnv_S3WithFallbackBucket(t *testing.T) {
	t.Setenv("BLOB_PROVIDER", "s3")
	t.Setenv("BLOB_BUCKET", "")
	s, err := NewFromEnv(context.Background(), aws.Config{}, "fallback-bucket")
	if err != nil {
		t.Fatal(err)
	}
	if s.Name() != "s3" {
		t.Fatalf("expected s3, got %q", s.Name())
	}
}

func TestNewFromEnv_FSAlias(t *testing.T) {
	t.Setenv("BLOB_PROVIDER", "fs")
	t.Setenv("BLOB_FS_ROOT", t.TempDir())
	s, err := NewFromEnv(context.Background(), aws.Config{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if s.Name() != "filesystem" {
		t.Fatalf("expected filesystem, got %q", s.Name())
	}
}
