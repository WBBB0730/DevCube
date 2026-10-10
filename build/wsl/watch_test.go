package main

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// 收集监听事件，等到出现满足条件的路径为止。
type eventSink struct {
	mu     sync.Mutex
	events []watchEvent
}

func (s *eventSink) add(batch []watchEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, batch...)
}

func (s *eventSink) waitFor(t *testing.T, path string, kind string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		for _, e := range s.events {
			if e.Path == path && e.Type == kind {
				s.mu.Unlock()
				return
			}
		}
		s.mu.Unlock()
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("没等到 %s %s；收到 %+v", kind, path, s.events)
}

func TestDirWatchRecursiveIncludingNewDirs(t *testing.T) {
	root, _ := filepath.EvalSymlinks(t.TempDir())
	if err := os.MkdirAll(filepath.Join(root, "a", "b"), 0o755); err != nil {
		t.Fatal(err)
	}
	sink := &eventSink{}
	w, err := startDirWatch(root, sink.add, func(string) {})
	if err != nil {
		t.Fatal(err)
	}
	defer w.close()

	deep := filepath.Join(root, "a", "b", "x.txt")
	if err := os.WriteFile(deep, []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}
	sink.waitFor(t, deep, "create")

	// 新建的目录随后补上监听，其中的变化也能收到
	fresh := filepath.Join(root, "new")
	if err := os.Mkdir(fresh, 0o755); err != nil {
		t.Fatal(err)
	}
	sink.waitFor(t, fresh, "create")
	time.Sleep(100 * time.Millisecond)
	inner := filepath.Join(fresh, "y.txt")
	if err := os.WriteFile(inner, []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}
	sink.waitFor(t, inner, "create")

	if err := os.Remove(deep); err != nil {
		t.Fatal(err)
	}
	sink.waitFor(t, deep, "delete")
}

func TestDirWatchRejectsMissingRoot(t *testing.T) {
	if _, err := startDirWatch(filepath.Join(t.TempDir(), "missing"), func([]watchEvent) {}, func(string) {}); err == nil {
		t.Fatal("目录不存在应报错")
	}
}

func TestReadDirAndFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"scripts":{}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	names, err := readDirNames(dir)
	if err != nil || len(names.Names) != 1 || names.Names[0] != "package.json" || names.NotFound {
		t.Fatalf("%+v %v", names, err)
	}
	missingDir, err := readDirNames(filepath.Join(dir, "nope"))
	if err != nil || !missingDir.NotFound {
		t.Fatalf("%+v %v", missingDir, err)
	}
	file, err := readFile(filepath.Join(dir, "package.json"))
	if err != nil || string(file.Data) != `{"scripts":{}}` {
		t.Fatalf("%+v %v", file, err)
	}
	missing, err := readFile(filepath.Join(dir, "pubspec.yaml"))
	if err != nil || !missing.NotFound {
		t.Fatalf("%+v %v", missing, err)
	}
}
