// Package queue defines the background jobs exchanged between the API
// (producer) and the worker (consumer) through Redis via Asynq.
package queue

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

const (
	TypeProcessDocument = "document:process"

	// MaxRetry is how many times a failed processing job is retried
	// (with Asynq's exponential backoff) before the document is marked failed.
	MaxRetry = 3
)

type ProcessDocumentPayload struct {
	DocumentID string `json:"document_id"`
}

func NewProcessDocumentTask(documentID string) (*asynq.Task, error) {
	payload, err := json.Marshal(ProcessDocumentPayload{DocumentID: documentID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TypeProcessDocument, payload,
		asynq.MaxRetry(MaxRetry),
		asynq.Timeout(15*time.Minute), // local LLMs on CPU can be slow
		asynq.Queue("default"),
	), nil
}

func ParseProcessDocument(t *asynq.Task) (ProcessDocumentPayload, error) {
	var p ProcessDocumentPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil || p.DocumentID == "" {
		return p, fmt.Errorf("bad %s payload: %w", TypeProcessDocument, asynq.SkipRetry)
	}
	return p, nil
}

// Enqueuer is the producer side used by HTTP handlers.
type Enqueuer interface {
	EnqueueProcessDocument(documentID string) error
}

type AsynqEnqueuer struct{ Client *asynq.Client }

func (e AsynqEnqueuer) EnqueueProcessDocument(documentID string) error {
	task, err := NewProcessDocumentTask(documentID)
	if err != nil {
		return err
	}
	_, err = e.Client.Enqueue(task)
	return err
}
