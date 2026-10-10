package main

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestParseEnvOutputSkipsStartupNoise(t *testing.T) {
	var out bytes.Buffer
	out.WriteString("Welcome! rc 脚本的输出\n")
	printEnv(&out)
	out.WriteString("\nbye\n")
	env, err := parseEnvOutput(out.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(env, os.Environ()) {
		t.Fatalf("环境不一致")
	}
}

func TestParseEnvOutputWithoutMarker(t *testing.T) {
	if _, err := parseEnvOutput([]byte("nothing")); err == nil {
		t.Fatal("没有标记时应报错")
	}
}

func TestPasswdShell(t *testing.T) {
	file := filepath.Join(t.TempDir(), "passwd")
	content := "root:x:0:0:root:/root:/bin/bash\nme:x:1000:1000::/home/me:/usr/bin/zsh\n"
	if err := os.WriteFile(file, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := passwdShell(file, 1000); got != "/usr/bin/zsh" {
		t.Fatalf("got %q", got)
	}
	if got := passwdShell(file, 1001); got != "" {
		t.Fatalf("got %q", got)
	}
}

func TestShellQuote(t *testing.T) {
	if got := shellQuote("/mnt/c/Program Files/it's"); got != `'/mnt/c/Program Files/it'\''s'` {
		t.Fatalf("got %s", got)
	}
}
