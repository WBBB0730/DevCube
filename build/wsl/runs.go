package main

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// runs 记着运行会话的进程组：每个会话一个文件（文件名为会话 id，内容为进程组号），由 launch 子命令写入。
// 常驻的小助手据此在发行版里结束整个进程组——结束 Windows 侧的 wsl.exe 不一定能结束发行版里的进程。
type runs struct{ dir string }

func newRuns() (*runs, error) {
	dir, err := os.MkdirTemp("", "devcube-wsl-runs-")
	if err != nil {
		return nil, err
	}
	return &runs{dir: dir}, nil
}

// signalByName 只认运行会话用到的几个信号。
func signalByName(name string) (syscall.Signal, error) {
	switch name {
	case "SIGINT":
		return syscall.SIGINT, nil
	case "SIGTERM":
		return syscall.SIGTERM, nil
	case "SIGKILL":
		return syscall.SIGKILL, nil
	}
	return 0, errors.New("不支持的信号：" + name)
}

func (r *runs) pgid(id string) (int, error) {
	if id == "" || strings.ContainsAny(id, "/\\") {
		return 0, errors.New("会话 id 不合法")
	}
	data, err := os.ReadFile(filepath.Join(r.dir, id))
	if err != nil {
		return 0, err
	}
	pgid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pgid <= 1 {
		return 0, errors.New("进程组号不合法")
	}
	return pgid, nil
}

// kill 给会话的整个进程组发信号；会话还没登记（刚起、launch 还没写文件）时报错，由主进程退回结束 wsl.exe。
func (r *runs) kill(id string, signal string) error {
	sig, err := signalByName(signal)
	if err != nil {
		return err
	}
	pgid, err := r.pgid(id)
	if err != nil {
		return err
	}
	return syscall.Kill(-pgid, sig)
}

// forget 删掉已结束会话的登记，免得进程组号被复用后误伤。
func (r *runs) forget(id string) {
	if id != "" && !strings.ContainsAny(id, "/\\") {
		_ = os.Remove(filepath.Join(r.dir, id))
	}
}

// killAll 在小助手退出时结束仍登记着的会话，再删掉登记目录。
func (r *runs) killAll() {
	entries, _ := os.ReadDir(r.dir)
	for _, entry := range entries {
		_ = r.kill(entry.Name(), "SIGKILL")
	}
	_ = os.RemoveAll(r.dir)
}
