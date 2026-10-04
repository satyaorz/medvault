// Package storage keeps original uploaded files in S3-compatible object storage
// (SeaweedFS locally; AWS S3 / MinIO / R2 work the same way).
package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Store struct {
	client *minio.Client
	bucket string
}

func New(endpoint, accessKey, secretKey, bucket string, useSSL bool) (*Store, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:        credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure:       useSSL,
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		return nil, fmt.Errorf("s3 client: %w", err)
	}
	return &Store{client: client, bucket: bucket}, nil
}

// EnsureBucket creates the bucket on first start.
func (s *Store) EnsureBucket(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("check bucket: %w", err)
	}
	if exists {
		return nil
	}
	if err := s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{}); err != nil {
		var resp minio.ErrorResponse
		if errors.As(err, &resp) && (resp.Code == "BucketAlreadyOwnedByYou" || resp.Code == "BucketAlreadyExists") {
			return nil
		}
		return fmt.Errorf("create bucket: %w", err)
	}
	return nil
}

func (s *Store) Put(ctx context.Context, key, contentType string, data []byte) error {
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return fmt.Errorf("put %s: %w", key, err)
	}
	return nil
}

// Open streams an object; the caller must close it.
func (s *Store) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("get %s: %w", key, err)
	}
	// GetObject is lazy; Stat surfaces "not found" before we start streaming.
	if _, err := obj.Stat(); err != nil {
		obj.Close()
		return nil, fmt.Errorf("stat %s: %w", key, err)
	}
	return obj, nil
}

func (s *Store) Get(ctx context.Context, key string) ([]byte, error) {
	rc, err := s.Open(ctx, key)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

func (s *Store) Delete(ctx context.Context, key string) error {
	return s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

func (s *Store) Ping(ctx context.Context) error {
	_, err := s.client.BucketExists(ctx, s.bucket)
	return err
}
