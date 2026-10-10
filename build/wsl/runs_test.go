package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"
)

// 起一个自成进程组、带后台子进程的命令，登记到 r 里。
func startGroup(t *testing.T, r *runs, id string) *exec.Cmd {
	t.Helper()
	cmd := exec.Command("sh", "-c", "sleep 30 & sleep 30")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(r.dir, id), []byte(strconv.Itoa(cmd.Process.Pid)), 0o600); err != nil {
		t.Fatal(err)
	}
	return cmd
}

func waitExit(t *testing.T, cmd *exec.Cmd) {
	t.Helper()
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("进程组没有被结束")
	}
}

func TestRunsKillEndsWholeGroup(t *testing.T) {
	r, err := newRuns()
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(r.dir)
	cmd := startGroup(t, r, "run-1")
	if err := r.kill("run-1", "SIGTERM"); err != nil {
		t.Fatal(err)
	}
	waitExit(t, cmd)
	// 后台子进程也随组结束
	if err := syscall.Kill(-cmd.Process.Pid, 0); err == nil {
		t.Fatal("组里还有进程")
	}
}

func TestRunsRejectsUnknownAndUnsafe(t *testing.T) {
	r, err := newRuns()
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(r.dir)
	if err := r.kill("missing", "SIGTERM"); err == nil {
		t.Fatal("未登记的会话应报错")
	}
	if err := r.kill("../etc/passwd", "SIGTERM"); err == nil {
		t.Fatal("带路径的 id 应报错")
	}
	if err := r.kill("x", "SIGHUP"); err == nil {
		t.Fatal("不支持的信号应报错")
	}
}

func TestRunsKillAllOnExitAndForget(t *testing.T) {
	r, err := newRuns()
	if err != nil {
		t.Fatal(err)
	}
	live := startGroup(t, r, "live")
	forgotten := startGroup(t, r, "done")
	r.forget("done")
	r.killAll()
	waitExit(t, live)
	if _, err := os.Stat(r.dir); !os.IsNotExist(err) {
		t.Fatal("登记目录没有删掉")
	}
	// 已 forget 的不在 killAll 之列
	if err := syscall.Kill(forgotten.Process.Pid, 0); err != nil {
		t.Fatal("forget 掉的会话不该被结束")
	}
	_ = syscall.Kill(-forgotten.Process.Pid, syscall.SIGKILL)
	_ = forgotten.Wait()
}

func TestParseLaunchArgs(t *testing.T) {
	a, err := parseLaunchArgs([]string{"--run-dir", "/tmp/r", "--id", "s1", "--env", "A=1", "--env", "B=x=y", "--", "/bin/bash", "-l", "-i", "-c", "echo hi"})
	if err != nil {
		t.Fatal(err)
	}
	if a.runDir != "/tmp/r" || a.id != "s1" || len(a.env) != 2 || a.env[1] != "B=x=y" || len(a.command) != 5 || a.command[4] != "echo hi" {
		t.Fatalf("%+v", a)
	}
	if _, err := parseLaunchArgs([]string{"--id", "s1", "--", "sh"}); err == nil {
		t.Fatal("缺 --run-dir 应报错")
	}
	if _, err := parseLaunchArgs([]string{"--run-dir", "/tmp", "--id", "s1", "--env", "noequals", "--", "sh"}); err == nil {
		t.Fatal("--env 不是 K=V 应报错")
	}
}

func TestLaunchRegistersGroupAndExecs(t *testing.T) {
	// 编出小助手，跑一遍真实的 launch 子命令
	bin := filepath.Join(t.TempDir(), "devcube-wsl")
	if out, err := exec.Command("go", "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	runDir := t.TempDir()
	cmd := exec.Command(bin, "launch", "--run-dir", runDir, "--id", "s1", "--env", "GREETING=hi", "--", "sh", "-c", `printf %s "$GREETING"; sleep 30`)
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 2)
	if _, err := out.Read(buf); err != nil || string(buf) != "hi" {
		t.Fatalf("%q %v", buf, err)
	}
	r := &runs{dir: runDir}
	pgid, err := r.pgid("s1")
	if err != nil || pgid != cmd.Process.Pid {
		t.Fatalf("登记的进程组 %d，进程 %d：%v", pgid, cmd.Process.Pid, err)
	}
	if err := r.kill("s1", "SIGKILL"); err != nil {
		t.Fatal(err)
	}
	waitExit(t, cmd)
}
