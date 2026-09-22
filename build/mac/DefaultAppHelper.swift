// macOS「设为默认打开方式」小助手（docs/prd/file-preview-window.md）。
// Electron 只暴露 URL scheme 的默认程序接口，文件类型要走 LaunchServices；
// 这里把 NSWorkspace 的官方接口包成一行式 CLI，随应用一起签名公证，由主进程 execFile 调用。
//
// 用法：
//   default-app-helper get <ext>...              每行输出 `<ext>\t<默认应用 bundle id>\t<默认应用路径>`（无默认则两段为空）
//   default-app-helper set <appPath> <ext>...    把各扩展名的默认打开方式设为该应用（.app 路径）；全部成功退出码 0
//   default-app-helper register <appPath>        向 LaunchServices 注册 / 刷新一个应用（Dev 身份的小壳）
// 按路径而非 bundle id 指定应用：Dev 身份跑的是 node_modules 里的 Electron.app，没有自己的 bundle id。
import AppKit
import Foundation
import UniformTypeIdentifiers

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else {
  FileHandle.standardError.write("usage: default-app-helper get <ext>... | set <appPath> <ext>... | register <appPath>\n".data(using: .utf8)!)
  exit(2)
}
let workspace = NSWorkspace.shared

func contentType(_ ext: String) -> UTType? {
  UTType(filenameExtension: ext.lowercased())
}

switch command {
case "get":
  for ext in args.dropFirst() {
    var bundleId = ""
    var path = ""
    if let type = contentType(ext), let url = workspace.urlForApplication(toOpen: type) {
      bundleId = Bundle(url: url)?.bundleIdentifier ?? ""
      path = url.path
    }
    print("\(ext)\t\(bundleId)\t\(path)")
  }
  exit(0)

case "set":
  guard args.count >= 3 else { exit(2) }
  let appUrl = URL(fileURLWithPath: args[1])
  guard Bundle(url: appUrl) != nil else {
    FileHandle.standardError.write("application not found: \(args[1])\n".data(using: .utf8)!)
    exit(1)
  }
  let group = DispatchGroup()
  var failures = 0
  for ext in args.dropFirst(2) {
    guard let type = contentType(ext) else {
      failures += 1
      continue
    }
    group.enter()
    workspace.setDefaultApplication(at: appUrl, toOpen: type) { error in
      if let error {
        failures += 1
        FileHandle.standardError.write("\(ext): \(error.localizedDescription)\n".data(using: .utf8)!)
      }
      group.leave()
    }
  }
  // 完成回调可能派发到主队列：不能同步 wait，改为跑主 RunLoop 等 notify
  group.notify(queue: .main) { exit(failures == 0 ? 0 : 1) }
  RunLoop.main.run()

case "register":
  guard args.count == 2 else { exit(2) }
  let status = LSRegisterURL(URL(fileURLWithPath: args[1]) as CFURL, true)
  if status != noErr {
    FileHandle.standardError.write("LSRegisterURL failed: \(status)\n".data(using: .utf8)!)
    exit(1)
  }
  exit(0)

default:
  exit(2)
}
