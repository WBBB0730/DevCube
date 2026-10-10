// DevCube 的 WSL 小助手（ADR-0055、docs/prd/wsl-project.md）：在发行版里常驻，经标准输入输出与主进程通信
// （JSON-RPC 2.0，按 LSP 的 Content-Length 分帧），替它在发行版的登录环境里执行命令、结束运行会话的进程组。
// 子命令 launch 是运行会话在 PTY 里的入口（见 launch.go），printenv 供取登录环境（见 env.go）。
// 由 `wsl.exe -d <发行版> --cd <所在目录> --exec ./devcube-wsl` 启动；标准输入关闭即退出，并结束它起的进程。
package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "printenv":
			printEnv(os.Stdout)
			return
		case "launch":
			if err := launch(os.Args[2:]); err != nil {
				fmt.Fprintf(os.Stderr, "无法启动：%v\n", err)
				os.Exit(127)
			}
			return
		default:
			fmt.Fprintf(os.Stderr, "未知的子命令：%s\n", os.Args[1])
			os.Exit(2)
		}
	}
	serve(os.Stdin, os.Stdout, captureLoginEnv)
}
