package main

import (
	"context"
	"encoding/json"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/sourcegraph/jsonrpc2"
)

// 起一个小助手服务并连上客户端；通知交给 onNotify。
func startServer(t *testing.T, onNotify func(*jsonrpc2.Request)) *jsonrpc2.Conn {
	t.Helper()
	serverSide, clientSide := net.Pipe()
	capture := func(string) ([]string, error) { return []string{"PATH=/usr/bin:/bin", "LOGIN=yes"}, nil }
	go serve(serverSide, serverSide, capture)
	handler := jsonrpc2.HandlerWithError(func(_ context.Context, _ *jsonrpc2.Conn, req *jsonrpc2.Request) (any, error) {
		if onNotify != nil {
			onNotify(req)
		}
		return nil, nil
	})
	conn := jsonrpc2.NewConn(context.Background(), jsonrpc2.NewBufferedStream(clientSide, jsonrpc2.VSCodeObjectCodec{}), handler)
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func TestServerInitializeThenExecUsesLoginEnv(t *testing.T) {
	conn := startServer(t, nil)
	var init initializeResult
	if err := conn.Call(context.Background(), "initialize", nil, &init); err != nil {
		t.Fatal(err)
	}
	if init.Executable == "" || init.Shell == "" || init.RunDir == "" {
		t.Fatalf("%+v", init)
	}
	var r execResult
	if err := conn.Call(context.Background(), "exec", execParams{File: "sh", Args: []string{"-c", "printf %s \"$LOGIN\""}, Cwd: "/"}, &r); err != nil {
		t.Fatal(err)
	}
	if string(r.Stdout) != "yes" {
		t.Fatalf("%+v", r)
	}
}

func TestServerStreamsBeforeReplying(t *testing.T) {
	var mu sync.Mutex
	var out string
	conn := startServer(t, func(req *jsonrpc2.Request) {
		if req.Method != "exec/data" {
			return
		}
		var d execData
		_ = json.Unmarshal(*req.Params, &d)
		mu.Lock()
		out += string(d.Data)
		mu.Unlock()
	})
	var r execResult
	if err := conn.Call(context.Background(), "exec", execParams{File: "sh", Args: []string{"-c", "echo 1; echo 2"}, Cwd: "/", Stream: "x"}, &r); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if out != "1\n2\n" {
		t.Fatalf("%q", out)
	}
}

func TestServerCancelRequest(t *testing.T) {
	conn := startServer(t, nil)
	done := make(chan execResult, 1)
	id := jsonrpc2.ID{Num: 42}
	call, err := conn.DispatchCall(context.Background(), "exec", execParams{File: "sleep", Args: []string{"30"}, Cwd: "/"}, jsonrpc2.PickID(id))
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		var r execResult
		_ = call.Wait(context.Background(), &r)
		done <- r
	}()
	time.Sleep(100 * time.Millisecond)
	if err := conn.Notify(context.Background(), "$/cancelRequest", map[string]any{"id": id}); err != nil {
		t.Fatal(err)
	}
	select {
	case r := <-done:
		if r.Code != -1 {
			t.Fatalf("%+v", r)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("取消后没有结束")
	}
}

func TestServerUnknownMethod(t *testing.T) {
	conn := startServer(t, nil)
	err := conn.Call(context.Background(), "nope", nil, nil)
	if err == nil {
		t.Fatal("未知方法应报错")
	}
}
