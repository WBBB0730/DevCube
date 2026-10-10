package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// execParams 是 exec 请求：在 Cwd 里执行 File（不经 shell），环境为登录环境再叠加 Env。
type execParams struct {
	File  string            `json:"file"`
	Args  []string          `json:"args"`
	Cwd   string            `json:"cwd"`
	Env   map[string]string `json:"env,omitempty"`
	Stdin []byte            `json:"stdin,omitempty"`
	// Stream 非空即流式：输出按块以 exec/data 通知推送（带上这个标记），结果里不再带输出。
	Stream string `json:"stream,omitempty"`
}

// execResult 是 exec 的结果；进程起不来时 Code 为 -1、Error 写明原因，被信号结束时 Code 也为 -1（同 Node）。
type execResult struct {
	Code   int    `json:"code"`
	Stdout []byte `json:"stdout,omitempty"`
	Stderr []byte `json:"stderr,omitempty"`
	Error  string `json:"error,omitempty"`
	// NotFound：可执行文件在 PATH 里找不到（主进程据此提示「发行版中未找到 git」）。
	NotFound bool `json:"notFound,omitempty"`
}

// execData 是流式输出的一块：Fd 为 stdout 或 stderr。
type execData struct {
	Stream string `json:"stream"`
	Fd     string `json:"fd"`
	Data   []byte `json:"data"`
}

// runExec 执行一条命令并等它结束。命令自成进程组，ctx 取消时结束整个进程组（含它起的子进程）。
func runExec(ctx context.Context, p execParams, base []string, notify func(execData)) execResult {
	env := mergeEnv(base, p.Env)
	path, err := lookPath(p.File, env)
	if err != nil {
		return execResult{Code: -1, Error: err.Error(), NotFound: true}
	}
	cmd := exec.Command(path, p.Args...)
	cmd.Dir = p.Cwd
	cmd.Env = env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if p.Stdin != nil {
		cmd.Stdin = bytes.NewReader(p.Stdin)
	}
	var stdout, stderr bytes.Buffer
	if p.Stream != "" {
		cmd.Stdout = dataWriter{p.Stream, "stdout", notify}
		cmd.Stderr = dataWriter{p.Stream, "stderr", notify}
	} else {
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
	}
	if err := cmd.Start(); err != nil {
		return execResult{Code: -1, Error: err.Error()}
	}
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		case <-done:
		}
	}()
	_ = cmd.Wait()
	close(done)
	return execResult{Code: cmd.ProcessState.ExitCode(), Stdout: stdout.Bytes(), Stderr: stderr.Bytes()}
}

// dataWriter 把写入的每一块转成一条 exec/data 通知。
type dataWriter struct {
	stream string
	fd     string
	notify func(execData)
}

func (w dataWriter) Write(b []byte) (int, error) {
	w.notify(execData{Stream: w.stream, Fd: w.fd, Data: bytes.Clone(b)})
	return len(b), nil
}

// mergeEnv 在 base 上叠加 overrides（同名覆盖）。
func mergeEnv(base []string, overrides map[string]string) []string {
	out := make([]string, 0, len(base)+len(overrides))
	for _, kv := range base {
		key, _, _ := strings.Cut(kv, "=")
		if _, ok := overrides[key]; !ok {
			out = append(out, kv)
		}
	}
	for key, value := range overrides {
		out = append(out, key+"="+value)
	}
	return out
}

// lookPath 按 env 里的 PATH 找可执行文件（exec.LookPath 只认小助手自身的 PATH，而命令要按登录环境找）。
func lookPath(file string, env []string) (string, error) {
	if strings.Contains(file, "/") {
		return file, nil
	}
	pathEnv := ""
	for _, kv := range env {
		if value, ok := strings.CutPrefix(kv, "PATH="); ok {
			pathEnv = value
		}
	}
	for _, dir := range filepath.SplitList(pathEnv) {
		if dir == "" {
			dir = "."
		}
		candidate := filepath.Join(dir, file)
		if st, err := os.Stat(candidate); err == nil && !st.IsDir() && st.Mode()&0o111 != 0 {
			return candidate, nil
		}
	}
	return "", errors.New("未找到 " + file)
}
