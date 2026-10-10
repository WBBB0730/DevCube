package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// envMarker 包住 printenv 输出的 JSON：交互式登录 shell 的启动脚本也可能往标准输出写东西，取标记之间的部分。
const envMarker = "\x00devcube-env\x00"

// loginEnvTimeout：启动脚本卡住（等网络、等输入）时不无限等，退回小助手自身的环境。
const loginEnvTimeout = 10 * time.Second

// printEnv 是 `printenv` 子命令：把自身环境写成 JSON 包在标记之间。在登录 shell 里调用它，得到 shell 加载完启动脚本后的环境。
func printEnv(w io.Writer) {
	data, _ := json.Marshal(os.Environ())
	_, _ = io.WriteString(w, envMarker+string(data)+envMarker)
}

// parseEnvOutput 取出 printenv 写在标记之间的环境。
func parseEnvOutput(out []byte) ([]string, error) {
	parts := bytes.Split(out, []byte(envMarker))
	if len(parts) < 3 {
		return nil, errors.New("登录 shell 没有输出环境")
	}
	var env []string
	if err := json.Unmarshal(parts[len(parts)-2], &env); err != nil {
		return nil, err
	}
	return env, nil
}

// userShell 是当前用户的登录 shell：passwd 里的那一项，取不到再看 $SHELL，最后是 /bin/sh。
func userShell() string {
	if shell := passwdShell("/etc/passwd", os.Getuid()); shell != "" {
		return shell
	}
	if shell := os.Getenv("SHELL"); shell != "" {
		return shell
	}
	return "/bin/sh"
}

// passwdShell 在 passwd 格式的文件里找 uid 对应的 shell（第 7 列）。
func passwdShell(file string, uid int) string {
	f, err := os.Open(file)
	if err != nil {
		return ""
	}
	defer f.Close()
	id := strconv.Itoa(uid)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Split(scanner.Text(), ":")
		if len(fields) >= 7 && fields[2] == id {
			return fields[6]
		}
	}
	return ""
}

// captureLoginEnv 以交互式登录 shell 跑一次自身的 printenv，取得与用户在终端里一样的环境（PATH、nvm 等），
// 之后执行的命令都在这份环境下（VS Code、Zed 的 WSL 支持同样如此）。失败时返回 nil 与原因。
func captureLoginEnv(shell string) ([]string, error) {
	self, err := os.Executable()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), loginEnvTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, shell, "-l", "-i", "-c", shellQuote(self)+" printenv")
	// 自成会话、没有控制终端：交互式 shell 不会去抢终端
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	out, err := cmd.Output()
	if ctx.Err() != nil {
		return nil, errors.New("登录 shell 超时")
	}
	if env, parseErr := parseEnvOutput(out); parseErr == nil {
		return env, nil
	}
	if err != nil {
		return nil, err
	}
	return nil, errors.New("登录 shell 没有输出环境")
}

// shellQuote 用单引号包住参数（POSIX sh 与 fish 都认）。
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
