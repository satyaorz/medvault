package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"medvault/internal/store"
)

// allowedTypes maps sniffed content types to stored file extensions.
var allowedTypes = map[string]string{
	"application/pdf": ".pdf",
	"image/png":       ".png",
	"image/jpeg":      ".jpg",
	"image/webp":      ".webp",
}

var (
	docTypes    = map[string]bool{"prescription": true, "lab_report": true, "discharge_summary": true, "other": true}
	docStatuses = map[string]bool{"queued": true, "processing": true, "needs_review": true, "completed": true, "failed": true}
)

func (s *Server) uploadDocument(w http.ResponseWriter, r *http.Request) {
	uid, pid := userID(r), chi.URLParam(r, "profileID")
	if err := s.Store.CheckProfile(r.Context(), uid, pid); err != nil {
		s.writeStoreError(w, r, err, "profile")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, s.MaxUploadBytes+1<<20) // + room for form fields
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "payload_too_large",
				fmt.Sprintf("files must be at most %d MB", s.MaxUploadBytes>>20))
			return
		}
		writeError(w, http.StatusBadRequest, "bad_request", "expected a multipart/form-data upload")
		return
	}
	defer r.MultipartForm.RemoveAll() //nolint:errcheck

	file, header, err := r.FormFile("file")
	if err != nil {
		writeValidation(w, map[string]string{"file": "a file is required"})
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, s.MaxUploadBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "could not read the uploaded file")
		return
	}
	if int64(len(data)) > s.MaxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "payload_too_large",
			fmt.Sprintf("files must be at most %d MB", s.MaxUploadBytes>>20))
		return
	}
	if len(data) == 0 {
		writeValidation(w, map[string]string{"file": "the file is empty"})
		return
	}
	// Trust the bytes, not the client's Content-Type or extension.
	contentType := strings.Split(http.DetectContentType(data), ";")[0]
	ext, ok := allowedTypes[contentType]
	if !ok {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "upload a PDF, PNG, JPEG or WEBP file")
		return
	}

	meta, fields := uploadMeta(r.MultipartForm)
	if len(fields) > 0 {
		writeValidation(w, fields)
		return
	}

	sum := sha256.Sum256(data)
	sha := hex.EncodeToString(sum[:])
	if existing, dup, err := s.Store.FindDuplicate(r.Context(), pid, sha); err != nil {
		s.writeStoreError(w, r, err, "document")
		return
	} else if dup {
		writeDuplicate(w, existing)
		return
	}

	id := uuid.NewString()
	key := fmt.Sprintf("profiles/%s/%s%s", pid, id, ext)
	if err := s.Files.Put(r.Context(), key, contentType, data); err != nil {
		s.writeStoreError(w, r, err, "document")
		return
	}
	doc, err := s.Store.CreateDocument(r.Context(), store.NewDocument{
		ID: id, ProfileID: pid, Filename: cleanFilename(header.Filename, ext), ContentType: contentType,
		SHA256: sha, StorageKey: key, SizeBytes: int64(len(data)),
		Title: meta["title"], DocType: meta["doc_type"], DocDate: meta["doc_date"], Source: meta["source"],
	})
	if err != nil {
		s.deleteObjects(r, key)
		if errors.Is(err, store.ErrConflict) { // lost a race with an identical concurrent upload
			existing, _, _ := s.Store.FindDuplicate(r.Context(), pid, sha)
			writeDuplicate(w, existing)
			return
		}
		s.writeStoreError(w, r, err, "document")
		return
	}
	if err := s.Queue.EnqueueProcessDocument(id); err != nil {
		s.Log.Error("enqueue failed", "document_id", id, "error", err)
		msg := "could not schedule processing — use Reprocess to try again"
		s.Store.SetDocumentState(r.Context(), id, "failed", "failed", &msg) //nolint:errcheck
		doc.Status, doc.Stage, doc.Error = "failed", "failed", &msg
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"document": doc})
}

func writeDuplicate(w http.ResponseWriter, existingID string) {
	writeJSON(w, http.StatusConflict, map[string]apiError{"error": {
		Code: "conflict", Message: "this file has already been uploaded to this profile", ExistingID: existingID,
	}})
}

// uploadMeta extracts and validates the optional form fields.
func uploadMeta(f *multipart.Form) (map[string]*string, map[string]string) {
	meta, fields := map[string]*string{}, map[string]string{}
	for _, k := range []string{"title", "doc_type", "doc_date", "source"} {
		if vs := f.Value[k]; len(vs) > 0 {
			if v := strings.TrimSpace(vs[0]); v != "" {
				meta[k] = &v
			}
		}
	}
	validateDocMeta(meta, fields)
	return meta, fields
}

func validateDocMeta(meta map[string]*string, fields map[string]string) {
	if v := meta["doc_type"]; v != nil && !docTypes[*v] {
		fields["doc_type"] = "must be prescription, lab_report, discharge_summary or other"
	}
	if v := meta["doc_date"]; v != nil {
		d, err := time.Parse(time.DateOnly, *v)
		if err != nil || d.After(time.Now().AddDate(0, 0, 1)) || d.Year() < 1900 {
			fields["doc_date"] = "must be a past date in YYYY-MM-DD format"
		}
	}
	for _, k := range []string{"title", "source"} {
		if v := meta[k]; v != nil && len(*v) > 200 {
			fields[k] = "must be at most 200 characters"
		}
	}
}

// cleanFilename keeps a display-safe base name with the sniffed extension.
func cleanFilename(name, ext string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || r == '"' {
			return -1
		}
		return r
	}, name)
	if name == "" || name == "." || name == "/" {
		name = "document" + ext
	}
	if r := []rune(name); len(r) > 200 {
		name = string(r[:200])
	}
	return name
}

func (s *Server) listDocuments(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.DocumentFilter{
		Query: strings.TrimSpace(q.Get("q")), Type: q.Get("type"), Status: q.Get("status"),
		From: q.Get("from"), To: q.Get("to"), Limit: 50,
	}
	fields := map[string]string{}
	if f.Type != "" && !docTypes[f.Type] && f.Type != "unknown" {
		fields["type"] = "unknown document type"
	}
	if f.Status != "" && !docStatuses[f.Status] {
		fields["status"] = "unknown status"
	}
	for k, v := range map[string]string{"from": f.From, "to": f.To} {
		if _, err := time.Parse(time.DateOnly, v); v != "" && err != nil {
			fields[k] = "must be YYYY-MM-DD"
		}
	}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 100 {
			fields["limit"] = "must be between 1 and 100"
		}
		f.Limit = n
	}
	if v := q.Get("offset"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			fields["offset"] = "must be ≥ 0"
		}
		f.Offset = n
	}
	if len(fields) > 0 {
		writeValidation(w, fields)
		return
	}
	docs, total, err := s.Store.ListDocuments(r.Context(), userID(r), chi.URLParam(r, "profileID"), f)
	if err != nil {
		s.writeStoreError(w, r, err, "profile")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"documents": docs, "total": total})
}

func (s *Server) getDocument(w http.ResponseWriter, r *http.Request) {
	d, err := s.Store.GetDocument(r.Context(), userID(r), chi.URLParam(r, "documentID"), true)
	if err != nil {
		s.writeStoreError(w, r, err, "document")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"document": d})
}

func (s *Server) documentFile(w http.ResponseWriter, r *http.Request) {
	d, err := s.Store.GetDocument(r.Context(), userID(r), chi.URLParam(r, "documentID"), false)
	if err != nil {
		s.writeStoreError(w, r, err, "document")
		return
	}
	rc, err := s.Files.Open(r.Context(), d.StorageKey)
	if err != nil {
		s.writeStoreError(w, r, err, "file")
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", d.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(d.SizeBytes, 10))
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename=%q`, d.Filename))
	// Uploaded content must never execute in our origin.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	w.Header().Set("Cache-Control", "private, max-age=300")
	if _, err := io.Copy(w, rc); err != nil {
		s.Log.Warn("streaming file interrupted", "document_id", d.ID, "error", err)
	}
}

func (s *Server) updateDocument(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title   *string `json:"title"`
		DocDate *string `json:"doc_date"`
		DocType *string `json:"doc_type"`
		Source  *string `json:"source"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	meta := map[string]*string{"title": trimPtr(in.Title), "doc_date": trimPtr(in.DocDate), "doc_type": trimPtr(in.DocType), "source": trimPtr(in.Source)}
	fields := map[string]string{}
	validateDocMeta(meta, fields)
	if len(fields) > 0 {
		writeValidation(w, fields)
		return
	}
	d, err := s.Store.UpdateDocument(r.Context(), userID(r), chi.URLParam(r, "documentID"), store.DocumentPatch{
		Title: meta["title"], DocDate: meta["doc_date"], DocType: meta["doc_type"], Source: meta["source"],
	})
	if err != nil {
		s.writeStoreError(w, r, err, "document")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"document": d})
}

func trimPtr(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}

func (s *Server) deleteDocument(w http.ResponseWriter, r *http.Request) {
	key, err := s.Store.DeleteDocument(r.Context(), userID(r), chi.URLParam(r, "documentID"))
	if err != nil {
		s.writeStoreError(w, r, err, "document")
		return
	}
	s.deleteObjects(r, key)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) reprocessDocument(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "documentID")
	d, err := s.Store.ResetForReprocess(r.Context(), userID(r), id)
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "conflict", "this document is already being processed")
		return
	}
	if err != nil {
		s.writeStoreError(w, r, err, "document")
		return
	}
	if err := s.Queue.EnqueueProcessDocument(id); err != nil {
		s.Log.Error("enqueue failed", "document_id", id, "error", err)
		msg := "could not schedule processing — try again"
		s.Store.SetDocumentState(r.Context(), id, "failed", "failed", &msg) //nolint:errcheck
		writeError(w, http.StatusServiceUnavailable, "internal", msg)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"document": d})
}
