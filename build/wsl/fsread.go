package main

import (
	"errors"
	"io/fs"
	"os"
)

// readDirResult 是 readDir 的结果：目录下的条目名；目录不存在时 NotFound。
type readDirResult struct {
	Names    []string `json:"names"`
	NotFound bool     `json:"notFound,omitempty"`
}

func readDirNames(dir string) (readDirResult, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return readDirResult{Names: []string{}, NotFound: true}, nil
	}
	if err != nil {
		return readDirResult{}, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return readDirResult{Names: names}, nil
}

// readFileResult 是 readFile 的结果：文件不存在时 NotFound（与读失败区分开，脚本检测据此决定要不要保留引用）。
type readFileResult struct {
	Data     []byte `json:"data,omitempty"`
	NotFound bool   `json:"notFound,omitempty"`
}

func readFile(path string) (readFileResult, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return readFileResult{NotFound: true}, nil
	}
	if err != nil {
		return readFileResult{}, err
	}
	return readFileResult{Data: data}, nil
}
