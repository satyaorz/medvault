// Package aiclient is the HTTP client for the stateless Python AI service
// (OCR, classification, extraction). See docs/CONTRACTS.md §2.
package aiclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	http    *http.Client
}

func New(baseURL string) *Client {
	// Per-call deadlines are set with contexts; this is only a safety net.
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), http: &http.Client{Timeout: 10 * time.Minute}}
}

type OCRPage struct {
	Page       int     `json:"page"`
	Text       string  `json:"text"`
	Method     string  `json:"method"`
	Confidence float64 `json:"confidence"`
}

type OCRResult struct {
	Text           string    `json:"text"`
	PageCount      int       `json:"page_count"`
	Method         string    `json:"method"`
	MeanConfidence float64   `json:"mean_confidence"`
	Pages          []OCRPage `json:"pages"`
}

type ClassifyResult struct {
	DocType    string             `json:"doc_type"`
	Confidence float64            `json:"confidence"`
	Method     string             `json:"method"`
	Scores     map[string]float64 `json:"scores"`
}

type DocumentMeta struct {
	Date        *string `json:"date"`
	Facility    *string `json:"facility"`
	Doctor      *string `json:"doctor"`
	PatientName *string `json:"patient_name"`
}

type Item struct {
	Kind       string          `json:"kind"`
	Data       json.RawMessage `json:"data"`
	SourceText *string         `json:"source_text"`
	Confidence float64         `json:"confidence"`
	Grounded   bool            `json:"grounded"`
	Issues     []string        `json:"issues"`
}

type ExtractResult struct {
	DocType  string       `json:"doc_type"`
	Provider string       `json:"provider"`
	Model    *string      `json:"model"`
	Document DocumentMeta `json:"document"`
	Items    []Item       `json:"items"`
}

// Error is a non-2xx response from the AI service.
type Error struct {
	Status int
	Body   string
}

func (e *Error) Error() string {
	return fmt.Sprintf("ai service returned %d: %s", e.Status, e.Body)
}

// Permanent reports whether retrying cannot help (bad input rather than an outage).
func (e *Error) Permanent() bool {
	return e.Status == http.StatusUnsupportedMediaType || e.Status == http.StatusUnprocessableEntity
}

func (c *Client) OCR(ctx context.Context, filename, contentType string, data []byte) (*OCRResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	h.Set("Content-Type", contentType)
	part, err := mw.CreatePart(h)
	if err != nil {
		return nil, err
	}
	if _, err := part.Write(data); err != nil {
		return nil, err
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}

	var out OCRResult
	return &out, c.do(ctx, "/ocr", mw.FormDataContentType(), &body, &out)
}

func (c *Client) Classify(ctx context.Context, text string) (*ClassifyResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	var out ClassifyResult
	return &out, c.postJSON(ctx, "/classify", map[string]any{"text": text}, &out)
}

func (c *Client) Extract(ctx context.Context, text, docType string, ocrConfidence float64) (*ExtractResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	var out ExtractResult
	return &out, c.postJSON(ctx, "/extract",
		map[string]any{"text": text, "doc_type": docType, "ocr_confidence": ocrConfidence}, &out)
}

func (c *Client) Health(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return &Error{Status: resp.StatusCode}
	}
	return nil
}

func (c *Client) postJSON(ctx context.Context, path string, in, out any) error {
	b, err := json.Marshal(in)
	if err != nil {
		return err
	}
	return c.do(ctx, path, "application/json", bytes.NewReader(b), out)
}

func (c *Client) do(ctx context.Context, path, contentType string, body io.Reader, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("ai service %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return &Error{Status: resp.StatusCode, Body: strings.TrimSpace(string(b))}
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode ai service %s response: %w", path, err)
	}
	return nil
}
