package pipeline

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"

	"medvault/internal/aiclient"
)

func TestUserFacingError(t *testing.T) {
	_, dialErr := net.Dial("tcp", "127.0.0.1:1") // nothing listens on port 1
	cases := []struct {
		err  error
		want string
	}{
		{fmt.Errorf("ocr: %w", dialErr), "unreachable"},
		{&aiclient.Error{Status: http.StatusUnsupportedMediaType}, "not supported"},
		{&aiclient.Error{Status: http.StatusUnprocessableEntity}, "corrupt"},
		{fmt.Errorf("x: %w", context.DeadlineExceeded), "timed out"},
		{errors.New(strings.Repeat("a", 400)), "…"},
	}
	for _, c := range cases {
		if got := userFacingError(c.err); !strings.Contains(got, c.want) {
			t.Errorf("userFacingError(%v) = %q, want it to contain %q", c.err, got, c.want)
		}
		if strings.Contains(userFacingError(c.err), "127.0.0.1") {
			t.Error("network details leaked")
		}
	}
	if !errors.Is(permanentIf(&aiclient.Error{Status: 422}), ErrPermanent) || errors.Is(permanentIf(&aiclient.Error{Status: 502}), ErrPermanent) {
		t.Error("permanentIf misclassified")
	}
}
