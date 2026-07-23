# Run 运行头经 shell 打印，不预写合成输出

运行头须留在控制台输出流里。若主进程在 PTY 数据之前合成写入，会被 Windows ConPTY 启动清屏盖掉；Unix PTY 无此主机清屏，故 Mac 无感。做法：按当前 shell 把「打印 ANSI 头 + 原命令」包进同一条 `-c` / `-Command` / `/c`，头成为进程真输出，落在清屏之后。
