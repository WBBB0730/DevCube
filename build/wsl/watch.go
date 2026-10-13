package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
)

// watchEvent 同 @parcel/watcher 的事件：绝对路径与 create / update / delete。
type watchEvent struct {
	Path string `json:"path"`
	Type string `json:"type"`
}

// watchBatchDelay：首个事件后攒这么久一起发（@parcel/watcher 在原生侧同样合并），免得逐条通知。
const watchBatchDelay = 50 * time.Millisecond

// dirWatch 是一个目录的递归监听（inotify 不能递归：逐个目录加监听，新建的目录随后补上）。
// 不按名字跳过任何目录——是否刷新由主进程按路径分类决定（ADR-0021 同款，不硬编码生态目录）。
type dirWatch struct {
	w       *fsnotify.Watcher
	onBatch func([]watchEvent)
	onError func(string)
	// dirs 是加上了监听的目录，改名 / 移走时据此撤掉整棵子树的监听（只在建立监听与事件循环里读写）
	dirs map[string]struct{}

	mu      sync.Mutex
	pending []watchEvent
	timer   *time.Timer
	done    chan struct{}
}

func startDirWatch(root string, onBatch func([]watchEvent), onError func(string)) (*dirWatch, error) {
	st, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !st.IsDir() {
		return nil, errors.New("不是目录：" + root)
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	d := &dirWatch{w: w, onBatch: onBatch, onError: onError, dirs: map[string]struct{}{}, done: make(chan struct{})}
	d.addTree(root)
	go d.loop()
	return d, nil
}

// addTree 给 dir 及其下所有目录加监听（不跟随符号链接）。超出系统监听上限等错误报给主进程（各通道强制刷新一次），
// 已加上的照常生效。
func (d *dirWatch) addTree(dir string) {
	limitReported := false
	_ = filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || !entry.IsDir() {
			return nil
		}
		if addErr := d.w.Add(path); addErr != nil {
			if errors.Is(addErr, syscall.ENOSPC) {
				if !limitReported {
					limitReported = true
					d.onError("文件监听数量超出系统上限（fs.inotify.max_user_watches）")
				}
				return filepath.SkipAll
			}
			return nil
		}
		d.dirs[path] = struct{}{}
		return nil
	})
}

// unwatchTree 撤掉改名 / 移走的目录及其下各目录的监听：inotify 的监听跟着目录本身走，留着的话之后的变化仍按旧路径报告，
// 移出根的也照报不误；fsnotify 对同一目录再加监听也不会换成新路径。新位置在根内时随其 create 事件重新加上。
func (d *dirWatch) unwatchTree(dir string) {
	if _, ok := d.dirs[dir]; !ok {
		return
	}
	prefix := dir + string(filepath.Separator)
	for path := range d.dirs {
		if path == dir || strings.HasPrefix(path, prefix) {
			delete(d.dirs, path)
			_ = d.w.Remove(path)
		}
	}
}

func (d *dirWatch) loop() {
	for {
		select {
		case event, ok := <-d.w.Events:
			if !ok {
				return
			}
			d.handle(event)
		case err, ok := <-d.w.Errors:
			if !ok {
				return
			}
			// 含内核事件队列溢出（fsnotify.ErrEventOverflow）：这批不完整，主进程各通道强制刷新
			d.onError(err.Error())
		case <-d.done:
			return
		}
	}
}

func (d *dirWatch) handle(event fsnotify.Event) {
	kind := "update"
	switch {
	case event.Has(fsnotify.Create):
		kind = "create"
		if st, err := os.Lstat(event.Name); err == nil && st.IsDir() {
			d.addTree(event.Name)
		}
	case event.Has(fsnotify.Remove):
		kind = "delete"
		delete(d.dirs, event.Name) // 删掉的目录，inotify 已自行撤掉监听
	case event.Has(fsnotify.Rename):
		kind = "delete"
		d.unwatchTree(event.Name)
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.pending = append(d.pending, watchEvent{Path: event.Name, Type: kind})
	if d.timer == nil {
		d.timer = time.AfterFunc(watchBatchDelay, d.flush)
	}
}

func (d *dirWatch) flush() {
	d.mu.Lock()
	batch := d.pending
	d.pending = nil
	d.timer = nil
	d.mu.Unlock()
	if len(batch) > 0 {
		d.onBatch(batch)
	}
}

func (d *dirWatch) close() {
	close(d.done)
	_ = d.w.Close()
	d.mu.Lock()
	if d.timer != nil {
		d.timer.Stop()
	}
	d.mu.Unlock()
}
