package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testEnv() []string { return []string{"PATH=/usr/bin:/bin", "HOME=/tmp"} }

func TestRunExecCollectsOutput(t *testing.T) {
	r := runExec(context.Background(), execParams{File: "sh", Args: []string{"-c", "echo out; echo err >&2; exit 3"}, Cwd: "/"}, testEnv(), nil)
	if r.Code != 3 || string(r.Stdout) != "out\n" || string(r.Stderr) != "err\n" || r.Error != "" {
		t.Fatalf("%+v", r)
	}
}

func TestRunExecStdinAndEnvAndCwd(t *testing.T) {
	dir := t.TempDir()
	p := execParams{File: "sh", Args: []string{"-c", "cat; printf %s \"$FOO\"; pwd"}, Cwd: dir, Env: map[string]string{"FOO": "bar"}, Stdin: []byte("in;")}
	r := runExec(context.Background(), p, testEnv(), nil)
	want, _ := filepath.EvalSymlinks(dir)
	got := strings.TrimSpace(string(r.Stdout))
	if !strings.HasPrefix(got, "in;bar") || !strings.HasSuffix(got, filepath.Base(want)) {
		t.Fatalf("%q", got)
	}
}

func TestRunExecNotFound(t *testing.T) {
	r := runExec(context.Background(), execParams{File: "definitely-not-here", Cwd: "/"}, testEnv(), nil)
	if r.Code != -1 || !r.NotFound {
		t.Fatalf("%+v", r)
	}
}

func TestRunExecStreams(t *testing.T) {
	var mu sync.Mutex
	var got []execData
	notify := func(d execData) { mu.Lock(); got = append(got, d); mu.Unlock() }
	r := runExec(context.Background(), execParams{File: "sh", Args: []string{"-c", "echo a; echo b >&2"}, Cwd: "/", Stream: "s1"}, testEnv(), notify)
	if r.Code != 0 || len(r.Stdout) != 0 {
		t.Fatalf("%+v", r)
	}
	var out, errOut string
	for _, d := range got {
		if d.Stream != "s1" {
			t.Fatalf("stream %q", d.Stream)
		}
		if d.Fd == "stdout" {
			out += string(d.Data)
		} else {
			errOut += string(d.Data)
		}
	}
	if out != "a\n" || errOut != "b\n" {
		t.Fatalf("%q %q", out, errOut)
	}
}

func TestRunExecCancelKillsProcessGroup(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "survived")
	ctx, cancel := context.WithCancel(context.Background())
	// 子 shell 里的后台进程在取消后若还活着，会在 1 秒后留下标记文件
	script := "(sleep 1; touch " + marker + ") & sleep 30"
	start := time.Now()
	go func() { time.Sleep(100 * time.Millisecond); cancel() }()
	r := runExec(ctx, execParams{File: "sh", Args: []string{"-c", script}, Cwd: "/"}, testEnv(), nil)
	if time.Since(start) > 5*time.Second || r.Code != -1 {
		t.Fatalf("%+v %v", r, time.Since(start))
	}
	time.Sleep(1500 * time.Millisecond)
	if _, err := os.Stat(marker); err == nil {
		t.Fatal("子进程没有被一起结束")
	}
}

func TestMergeEnvOverrides(t *testing.T) {
	got := mergeEnv([]string{"A=1", "B=2"}, map[string]string{"B": "3", "C": "4"})
	joined := strings.Join(got, ",")
	if !strings.Contains(joined, "A=1") || !strings.Contains(joined, "B=3") || strings.Contains(joined, "B=2") || !strings.Contains(joined, "C=4") {
		t.Fatalf("%v", got)
	}
}
