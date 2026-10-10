package main

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"sync"

	"github.com/sourcegraph/jsonrpc2"
)

// initializeResult 是 initialize 的结果：主进程据此知道小助手在发行版里的位置与用户的 shell。
type initializeResult struct {
	// Executable 是小助手自身在发行版里的绝对路径。
	Executable string `json:"executable"`
	// Shell 是用户的登录 shell（运行会话以它执行命令）。
	Shell string `json:"shell"`
	// RunDir 是运行会话登记进程组的目录（launch 子命令的 --run-dir）。
	RunDir string `json:"runDir"`
}

type server struct {
	captureEnv func(shell string) ([]string, error)
	runs       *runs
	runsErr    error

	mu      sync.Mutex
	env     []string
	running map[jsonrpc2.ID]context.CancelFunc
	watches map[string]*dirWatch
}

// stdio 把标准输入输出合成 jsonrpc2 需要的 ReadWriteCloser。
type stdio struct {
	io.Reader
	io.Writer
}

func (stdio) Close() error { return nil }

// serve 在 in / out 上提供服务，直到对端断开；断开时结束仍在执行的命令与仍登记着的运行会话。
func serve(in io.Reader, out io.Writer, captureEnv func(shell string) ([]string, error)) {
	s := &server{
		captureEnv: captureEnv,
		env:        os.Environ(),
		running:    map[jsonrpc2.ID]context.CancelFunc{},
		watches:    map[string]*dirWatch{},
	}
	s.runs, s.runsErr = newRuns()
	if s.runs != nil {
		defer s.runs.killAll()
	}
	stream := jsonrpc2.NewBufferedStream(stdio{in, out}, jsonrpc2.VSCodeObjectCodec{})
	conn := jsonrpc2.NewConn(context.Background(), stream, jsonrpc2.AsyncHandler(jsonrpc2.HandlerWithError(s.handle)))
	<-conn.DisconnectNotify()
	s.cancelAll()
	s.closeWatches()
}

func (s *server) handle(ctx context.Context, conn *jsonrpc2.Conn, req *jsonrpc2.Request) (any, error) {
	// 建不出登记目录就没法在发行版里结束运行会话：一律报错（初始化随之失败，连接带着原因失败）
	if s.runsErr != nil {
		return nil, &jsonrpc2.Error{Code: jsonrpc2.CodeInternalError, Message: "无法创建运行会话目录：" + s.runsErr.Error()}
	}
	switch req.Method {
	case "initialize":
		return s.initialize(), nil
	case "exec":
		var p execParams
		if err := unmarshalParams(req, &p); err != nil {
			return nil, err
		}
		ctx, cancel := context.WithCancel(ctx)
		s.track(req.ID, cancel)
		defer s.untrack(req.ID)
		notify := func(d execData) { _ = conn.Notify(context.Background(), "exec/data", d) }
		return runExec(ctx, p, s.environ(), notify), nil
	case "killRun":
		var p struct {
			ID     string `json:"id"`
			Signal string `json:"signal"`
		}
		if err := unmarshalParams(req, &p); err != nil {
			return nil, err
		}
		if err := s.runs.kill(p.ID, p.Signal); err != nil {
			return nil, &jsonrpc2.Error{Code: jsonrpc2.CodeInternalError, Message: err.Error()}
		}
		return nil, nil
	case "forgetRun":
		var p struct {
			ID string `json:"id"`
		}
		if err := unmarshalParams(req, &p); err == nil {
			s.runs.forget(p.ID)
		}
		return nil, nil
	case "watch":
		var p struct {
			ID   string `json:"id"`
			Root string `json:"root"`
		}
		if err := unmarshalParams(req, &p); err != nil {
			return nil, err
		}
		return nil, s.watch(conn, p.ID, p.Root)
	case "unwatch":
		var p struct {
			ID string `json:"id"`
		}
		if err := unmarshalParams(req, &p); err == nil {
			s.unwatch(p.ID)
		}
		return nil, nil
	case "readDir":
		var p struct {
			Path string `json:"path"`
		}
		if err := unmarshalParams(req, &p); err != nil {
			return nil, err
		}
		result, err := readDirNames(p.Path)
		if err != nil {
			return nil, &jsonrpc2.Error{Code: jsonrpc2.CodeInternalError, Message: err.Error()}
		}
		return result, nil
	case "readFile":
		var p struct {
			Path string `json:"path"`
		}
		if err := unmarshalParams(req, &p); err != nil {
			return nil, err
		}
		result, err := readFile(p.Path)
		if err != nil {
			return nil, &jsonrpc2.Error{Code: jsonrpc2.CodeInternalError, Message: err.Error()}
		}
		return result, nil
	case "$/cancelRequest":
		var p struct {
			ID jsonrpc2.ID `json:"id"`
		}
		if err := unmarshalParams(req, &p); err == nil {
			s.cancel(p.ID)
		}
		return nil, nil
	}
	return nil, &jsonrpc2.Error{Code: jsonrpc2.CodeMethodNotFound, Message: "未知方法：" + req.Method}
}

// initialize 取一次登录环境，之后的命令都在它下面执行；取不到时（启动脚本卡住、shell 不认 -l -i -c）
// 沿用小助手自身的环境（同 VS Code 的做法）。
func (s *server) initialize() initializeResult {
	self, _ := os.Executable()
	shell := userShell()
	if env, err := s.captureEnv(shell); err == nil {
		s.mu.Lock()
		s.env = env
		s.mu.Unlock()
	}
	return initializeResult{Executable: self, Shell: shell, RunDir: s.runs.dir}
}

func (s *server) environ() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.env
}

func (s *server) track(id jsonrpc2.ID, cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.running[id] = cancel
}

func (s *server) untrack(id jsonrpc2.ID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cancel, ok := s.running[id]; ok {
		cancel()
		delete(s.running, id)
	}
}

func (s *server) cancel(id jsonrpc2.ID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cancel, ok := s.running[id]; ok {
		cancel()
	}
}

func (s *server) cancelAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, cancel := range s.running {
		cancel()
	}
}

func unmarshalParams(req *jsonrpc2.Request, v any) error {
	if req.Params == nil {
		return &jsonrpc2.Error{Code: jsonrpc2.CodeInvalidParams, Message: "缺少参数"}
	}
	if err := json.Unmarshal(*req.Params, v); err != nil {
		return &jsonrpc2.Error{Code: jsonrpc2.CodeInvalidParams, Message: err.Error()}
	}
	return nil
}

// watch 递归监听 root：事件以 watch/events 通知批量推送，出错（超出监听上限、事件溢出）以 watch/error 通知。
func (s *server) watch(conn *jsonrpc2.Conn, id string, root string) error {
	onBatch := func(events []watchEvent) {
		_ = conn.Notify(context.Background(), "watch/events", map[string]any{"id": id, "events": events})
	}
	onError := func(message string) {
		_ = conn.Notify(context.Background(), "watch/error", map[string]any{"id": id, "message": message})
	}
	w, err := startDirWatch(root, onBatch, onError)
	if err != nil {
		return &jsonrpc2.Error{Code: jsonrpc2.CodeInternalError, Message: err.Error()}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.watches[id]; ok {
		old.close()
	}
	s.watches[id] = w
	return nil
}

func (s *server) unwatch(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if w, ok := s.watches[id]; ok {
		w.close()
		delete(s.watches, id)
	}
}

func (s *server) closeWatches() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, w := range s.watches {
		w.close()
		delete(s.watches, id)
	}
}
