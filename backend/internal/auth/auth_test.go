package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestPasswordRoundTrip(t *testing.T) {
	h, err := HashPassword("correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword(h, "correct horse battery") {
		t.Error("expected password to match")
	}
	if CheckPassword(h, "wrong") {
		t.Error("wrong password matched")
	}
	if CheckPassword("", "anything") {
		t.Error("empty hash must never match")
	}
}

func TestTokenIssueVerify(t *testing.T) {
	tk := NewTokens([]byte("0123456789abcdef0123456789abcdef"), time.Hour)
	tok, err := tk.Issue("user-1")
	if err != nil {
		t.Fatal(err)
	}
	got, err := tk.Verify(tok)
	if err != nil || got != "user-1" {
		t.Fatalf("Verify = %q, %v", got, err)
	}
}

func TestTokenRejections(t *testing.T) {
	secret := []byte("0123456789abcdef0123456789abcdef")
	tk := NewTokens(secret, time.Hour)

	t.Run("expired", func(t *testing.T) {
		past := NewTokens(secret, time.Hour)
		past.now = func() time.Time { return time.Now().Add(-2 * time.Hour) }
		tok, _ := past.Issue("u")
		if _, err := tk.Verify(tok); err == nil {
			t.Error("expired token accepted")
		}
	})
	t.Run("wrong secret", func(t *testing.T) {
		other := NewTokens([]byte("ffffffffffffffffffffffffffffffff"), time.Hour)
		tok, _ := other.Issue("u")
		if _, err := tk.Verify(tok); err == nil {
			t.Error("token signed with another secret accepted")
		}
	})
	t.Run("alg none", func(t *testing.T) {
		tok, _ := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.RegisteredClaims{
			Subject: "u", Issuer: issuer, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		}).SignedString(jwt.UnsafeAllowNoneSignatureType)
		if _, err := tk.Verify(tok); err == nil {
			t.Error("unsigned token accepted")
		}
	})
	t.Run("garbage", func(t *testing.T) {
		if _, err := tk.Verify("not-a-jwt"); err == nil {
			t.Error("garbage accepted")
		}
	})
}
