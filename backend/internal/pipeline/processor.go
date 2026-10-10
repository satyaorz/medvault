// Package pipeline runs the asynchronous document-processing job:
//
//	ocr → classifying → extracting → validating → done
//
// Each stage is recorded in processing_steps so the UI can show progress, and
// the AI service's output is validated by package extraction before anything
// is written to the medical record.
package pipeline

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strings"

	"medvault/internal/aiclient"
	"medvault/internal/extraction"
	"medvault/internal/store"
)

// AI is the subset of the AI service the pipeline needs (fakeable in tests).
type AI interface {
	OCR(ctx context.Context, filename, contentType string, data []byte) (*aiclient.OCRResult, error)
	Classify(ctx context.Context, text string) (*aiclient.ClassifyResult, error)
	Extract(ctx context.Context, text, docType string, ocrConfidence float64) (*aiclient.ExtractResult, error)
}

type Files interface {
	Get(ctx context.Context, key string) ([]byte, error)
}

type Processor struct {
	Store *store.Store
	Files Files
	AI    AI
	Log   *slog.Logger
}

// ErrPermanent wraps failures that retrying cannot fix (corrupt file, etc.).
var ErrPermanent = errors.New("permanent failure")

var validDocTypes = map[string]bool{"prescription": true, "lab_report": true, "discharge_summary": true, "other": true}

// Process runs the whole pipeline for one document. A returned error means
// the attempt failed; the caller decides whether to retry or call Fail.
func (p *Processor) Process(ctx context.Context, docID string) error {
	doc, err := p.Store.DocumentForProcessing(ctx, docID)
	if errors.Is(err, store.ErrNotFound) {
		p.Log.Info("document deleted before processing", "document_id", docID)
		return nil
	}
	if err != nil {
		return err
	}
	log := p.Log.With("document_id", docID)

	// 1. OCR
	var ocr *aiclient.OCRResult
	err = p.step(ctx, docID, "ocr", func() (string, error) {
		data, err := p.Files.Get(ctx, doc.StorageKey)
		if err != nil {
			return "", fmt.Errorf("read original: %w", err)
		}
		if ocr, err = p.AI.OCR(ctx, doc.Filename, doc.ContentType, data); err != nil {
			return "", permanentIf(err)
		}
		if err := p.Store.SaveOCR(ctx, docID, ocr.Text, ocr.Method, ocr.MeanConfidence, ocr.PageCount); err != nil {
			return "", err
		}
		return fmt.Sprintf("%d page(s) via %s, %d characters, confidence %.0f%%",
			ocr.PageCount, ocr.Method, len([]rune(ocr.Text)), ocr.MeanConfidence*100), nil
	})
	if err != nil {
		return err
	}
	if strings.TrimSpace(ocr.Text) == "" {
		for _, stage := range []string{"classifying", "extracting", "validating"} {
			p.skip(ctx, docID, stage, "no text could be read from this document")
		}
		_, err := p.Store.SaveExtraction(ctx, docID, doc.ProfileID, store.ExtractionResult{Provider: "none"})
		return err
	}

	// 2. Classification (skipped when the user chose the type)
	docType := doc.DocType
	if doc.DocTypeSource == "user" && validDocTypes[docType] {
		p.skip(ctx, docID, "classifying", "type set by user: "+docType)
	} else {
		err = p.step(ctx, docID, "classifying", func() (string, error) {
			c, err := p.AI.Classify(ctx, ocr.Text)
			if err != nil {
				return "", permanentIf(err)
			}
			if !validDocTypes[c.DocType] {
				c.DocType = "other"
			}
			docType = c.DocType
			if err := p.Store.SaveClassification(ctx, docID, c.DocType, c.Confidence); err != nil {
				return "", err
			}
			return fmt.Sprintf("%s (%.0f%% confidence, %s)", c.DocType, c.Confidence*100, c.Method), nil
		})
		if err != nil {
			return err
		}
	}

	// 3. Extraction
	var ext *aiclient.ExtractResult
	err = p.step(ctx, docID, "extracting", func() (string, error) {
		var err error
		if ext, err = p.AI.Extract(ctx, ocr.Text, docType, ocr.MeanConfidence); err != nil {
			return "", permanentIf(err)
		}
		model := ext.Provider
		if ext.Model != nil {
			model += " / " + *ext.Model
		}
		return fmt.Sprintf("%d item(s) extracted with %s", len(ext.Items), model), nil
	})
	if err != nil {
		return err
	}

	// 4. Validation + persistence
	return p.step(ctx, docID, "validating", func() (string, error) {
		result, accepted, rejected := p.validate(ext)
		status, err := p.Store.SaveExtraction(ctx, docID, doc.ProfileID, result)
		if err != nil {
			return "", err
		}
		log.Info("document processed", "status", status, "items", len(result.Items), "auto_accepted", accepted)
		msg := fmt.Sprintf("%d auto-accepted, %d need review", accepted, len(result.Items)-accepted)
		if rejected > 0 {
			msg += fmt.Sprintf(", %d discarded (unusable)", rejected)
		}
		return msg, nil
	})
}

// validate runs every AI item through the extraction gatekeeper and decides
// whether it may be auto-accepted.
func (p *Processor) validate(ext *aiclient.ExtractResult) (r store.ExtractionResult, accepted, discarded int) {
	r.Provider, r.Model = ext.Provider, ext.Model
	r.DocDate, r.Facility = ext.Document.Date, ext.Document.Facility
	if r.DocDate != nil && !extraction.ValidPastDate(*r.DocDate, p.Store.Today()) {
		r.DocDate = nil // only trust a well-formed, non-future document date
	}

	for _, it := range ext.Items {
		if !extraction.ValidKind(it.Kind) {
			discarded++
			continue
		}
		v, cleaned, problems, err := extraction.Validate(it.Kind, it.Data, p.Store.Today())
		if err != nil {
			// Undecodable payloads cannot be shown in a review form either.
			p.Log.Warn("discarding malformed AI item", "kind", it.Kind, "error", err)
			discarded++
			continue
		}
		issues := append([]string{}, it.Issues...)
		issues = append(issues, problems.Issues()...)
		ok := it.Confidence >= extraction.AutoAcceptThreshold && it.Grounded && len(issues) == 0
		if ok {
			accepted++
		}
		r.Items = append(r.Items, store.NewItem{
			Kind: it.Kind, Data: cleaned, Value: v, SourceText: it.SourceText,
			Confidence: it.Confidence, Grounded: it.Grounded, Issues: issues, Accepted: ok,
		})
	}
	return r, accepted, discarded
}

// Fail marks the document as failed after the final attempt.
func (p *Processor) Fail(ctx context.Context, docID string, cause error) {
	msg := userFacingError(cause)
	if err := p.Store.SetDocumentState(ctx, docID, "failed", "failed", &msg); err != nil {
		p.Log.Error("could not mark document failed", "document_id", docID, "error", err)
	}
}

// Retrying puts the document back in the queue state between attempts so the
// UI shows that another attempt is coming rather than a stuck "processing".
func (p *Processor) Retrying(ctx context.Context, docID string, attempt int, cause error) {
	msg := fmt.Sprintf("Attempt %d failed (%s) — retrying automatically.", attempt, userFacingError(cause))
	if err := p.Store.SetDocumentState(ctx, docID, "queued", "queued", &msg); err != nil {
		p.Log.Error("could not mark document for retry", "document_id", docID, "error", err)
	}
}

func (p *Processor) step(ctx context.Context, docID, stage string, fn func() (string, error)) error {
	if err := p.Store.SetStage(ctx, docID, stage); err != nil {
		return err
	}
	stepID, err := p.Store.StartStep(ctx, docID, stage)
	if err != nil {
		return err
	}
	msg, runErr := fn()
	status := "completed"
	if runErr != nil {
		status, msg = "failed", userFacingError(runErr)
	}
	// Use a detached context so a timed-out job still records its failure.
	if err := p.Store.FinishStep(context.WithoutCancel(ctx), stepID, status, msg); err != nil {
		p.Log.Error("finish step", "error", err)
	}
	if runErr != nil {
		return fmt.Errorf("%s: %w", stage, runErr)
	}
	return nil
}

func (p *Processor) skip(ctx context.Context, docID, stage, reason string) {
	id, err := p.Store.StartStep(ctx, docID, stage)
	if err == nil {
		err = p.Store.FinishStep(ctx, id, "skipped", reason)
	}
	if err != nil {
		p.Log.Error("record skipped step", "error", err)
	}
}

func permanentIf(err error) error {
	var aiErr *aiclient.Error
	if errors.As(err, &aiErr) && aiErr.Permanent() {
		return fmt.Errorf("%w: %w", ErrPermanent, err)
	}
	return err
}

func isNetworkError(err error) bool {
	var netErr net.Error
	var urlErr *url.Error
	return errors.As(err, &netErr) || errors.As(err, &urlErr)
}

func userFacingError(err error) string {
	var aiErr *aiclient.Error
	switch {
	case errors.As(err, &aiErr) && aiErr.Status == 415:
		return "This file type is not supported."
	case errors.As(err, &aiErr) && aiErr.Status == 422:
		return "The file appears to be corrupt or unreadable."
	case errors.Is(err, context.DeadlineExceeded):
		return "Processing timed out."
	case isNetworkError(err):
		// Don't leak hostnames/ports to users; the worker log has the details.
		return "The AI service is currently unreachable."
	}
	msg := err.Error()
	if len(msg) > 300 {
		msg = msg[:300] + "…"
	}
	return msg
}
