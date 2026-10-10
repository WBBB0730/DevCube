package main

import (
	"errors"
	"flag"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
	"golang.org/x/term"
)

// envFlags 收集可重复的 --env K=V。
type envFlags []string

func (e *envFlags) String() string { return strings.Join(*e, ",") }

func (e *envFlags) Set(v string) error {
	if !strings.Contains(v, "=") {
		return errors.New("--env 要写成 K=V")
	}
	*e = append(*e, v)
	return nil
}

// launchArgs 是 launch 子命令解析后的参数。
type launchArgs struct {
	runDir  string
	id      string
	env     []string
	command []string
}

func parseLaunchArgs(args []string) (launchArgs, error) {
	fs := flag.NewFlagSet("launch", flag.ContinueOnError)
	runDir := fs.String("run-dir", "", "")
	id := fs.String("id", "", "")
	var env envFlags
	fs.Var(&env, "env", "")
	if err := fs.Parse(args); err != nil {
		return launchArgs{}, err
	}
	if *runDir == "" || *id == "" || fs.NArg() == 0 {
		return launchArgs{}, errors.New("用法：devcube-wsl launch --run-dir <目录> --id <会话> [--env K=V]... -- <程序> [参数]...")
	}
	return launchArgs{runDir: *runDir, id: *id, env: env, command: fs.Args()}, nil
}

// launch 是运行会话在 PTY 里的入口：自成进程组并接管终端前台（Ctrl+C 才送得到），把组号登记到 run-dir/<id>，
// 设好配置的环境变量，再换成要执行的程序（exec，pid 与进程组不变）。常驻的小助手据登记结束整个进程组。
func launch(args []string) error {
	a, err := parseLaunchArgs(args)
	if err != nil {
		return err
	}
	if syscall.Getpgrp() != syscall.Getpid() {
		if err := syscall.Setpgid(0, 0); err != nil {
			return err
		}
	}
	pgid := syscall.Getpgrp()
	if term.IsTerminal(0) {
		// 不在前台的进程组设前台会收到 SIGTTOU，先忽略；exec 前恢复默认，不带进要执行的程序
		signal.Ignore(syscall.SIGTTOU)
		_ = unix.IoctlSetPointerInt(0, unix.TIOCSPGRP, pgid)
		signal.Reset(syscall.SIGTTOU)
	}
	if err := os.WriteFile(filepath.Join(a.runDir, a.id), []byte(strconv.Itoa(pgid)), 0o600); err != nil {
		return err
	}
	env := os.Environ()
	for _, kv := range a.env {
		key, value, _ := strings.Cut(kv, "=")
		env = mergeEnv(env, map[string]string{key: value})
	}
	path, err := lookPath(a.command[0], env)
	if err != nil {
		return err
	}
	return syscall.Exec(path, a.command, env)
}
