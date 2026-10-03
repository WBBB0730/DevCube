// 「用 DevCube 压缩」资源管理器经典右键扩展（ADR-0049，docs/prd/compress.md）。
// 实现 IExplorerCommand，以 ExplorerCommandHandler + MultiSelectModel=Player 注册为 `*` 与 `Directory` 的动词：
// 资源管理器把整个选区一次交给 Invoke，这里只启动一次 DevCube，带上 `--compress` 与全部路径
// （命令行装不下时改写一个清单文件，以 `--compress-list=<文件>` 传入）。
// 同一个 DLL 服务各个 Release Edition：COM 按 CLSID 找到本 DLL，菜单文案、图标与唤起命令都从
// HKCU\Software\Classes\CLSID\{clsid} 下读（由应用写入，见 src/main/windows-compress-menu.ts），这里不写死任何身份。
// 编译见 scripts/build-win-shell.ts。

#include <windows.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <shobjidl_core.h>
#include <wrl/client.h>
#include <wrl/implements.h>
#include <wrl/module.h>

#include <string>
#include <vector>

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::InProc;
using Microsoft::WRL::Make;
using Microsoft::WRL::Module;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

namespace {

// CreateProcess 的命令行上限是 32767 个字符（含结尾的空字符）
constexpr size_t kMaxCommandLine = 32766;

std::wstring ConfigKey(const GUID& clsid) {
  wchar_t guid[64] = {};
  StringFromGUID2(clsid, guid, ARRAYSIZE(guid));
  return std::wstring(L"Software\\Classes\\CLSID\\") + guid;
}

// 读 CLSID 键下的字符串值；不存在为空串
std::wstring ReadConfig(const GUID& clsid, const wchar_t* name) {
  const std::wstring key = ConfigKey(clsid);
  DWORD size = 0;
  if (RegGetValueW(HKEY_CURRENT_USER, key.c_str(), name, RRF_RT_REG_SZ, nullptr, nullptr, &size) !=
          ERROR_SUCCESS ||
      size == 0) {
    return L"";
  }
  std::wstring value(size / sizeof(wchar_t), L'\0');
  if (RegGetValueW(HKEY_CURRENT_USER, key.c_str(), name, RRF_RT_REG_SZ, nullptr, value.data(),
                   &size) != ERROR_SUCCESS) {
    return L"";
  }
  value.resize(wcslen(value.c_str()));
  return value;
}

// 按 CommandLineToArgvW 的规则加引号：反斜杠只在紧挨引号（含结尾的引号）时需要加倍
std::wstring QuoteArg(const std::wstring& arg) {
  std::wstring out = L"\"";
  size_t backslashes = 0;
  for (wchar_t c : arg) {
    if (c == L'\\') {
      ++backslashes;
      continue;
    }
    if (c == L'"') {
      out.append(backslashes * 2 + 1, L'\\');
    } else {
      out.append(backslashes, L'\\');
    }
    backslashes = 0;
    out.push_back(c);
  }
  out.append(backslashes * 2, L'\\');
  out.push_back(L'"');
  return out;
}

// 路径太多时写清单文件：临时目录下 devcube-compress-<pid>-<tick>.txt，UTF-8，一行一个路径
// （文件名格式与应用里的校验一致：只认临时目录里这样命名的文件）
std::wstring WriteList(const std::vector<std::wstring>& paths) {
  wchar_t dir[MAX_PATH + 1] = {};
  if (GetTempPathW(ARRAYSIZE(dir), dir) == 0) return L"";
  const std::wstring file = std::wstring(dir) + L"devcube-compress-" +
                            std::to_wstring(GetCurrentProcessId()) + L"-" +
                            std::to_wstring(GetTickCount64()) + L".txt";
  std::wstring text;
  for (const auto& p : paths) text += p + L"\n";
  const int bytes = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()),
                                        nullptr, 0, nullptr, nullptr);
  std::string utf8(static_cast<size_t>(bytes), '\0');
  WideCharToMultiByte(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), utf8.data(), bytes,
                      nullptr, nullptr);
  HANDLE handle = CreateFileW(file.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                              FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return L"";
  DWORD written = 0;
  const BOOL ok = WriteFile(handle, utf8.data(), static_cast<DWORD>(utf8.size()), &written, nullptr);
  CloseHandle(handle);
  if (!ok || written != utf8.size()) {
    DeleteFileW(file.c_str());
    return L"";
  }
  return file;
}

class CompressCommand : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IExplorerCommand> {
 public:
  explicit CompressCommand(const GUID& clsid) : clsid_(clsid) {}

  IFACEMETHODIMP GetTitle(IShellItemArray*, LPWSTR* name) override {
    *name = nullptr;
    const std::wstring title = ReadConfig(clsid_, L"Title");
    return title.empty() ? E_FAIL : SHStrDupW(title.c_str(), name);
  }

  IFACEMETHODIMP GetIcon(IShellItemArray*, LPWSTR* icon) override {
    *icon = nullptr;
    const std::wstring exe = ReadConfig(clsid_, L"Icon");
    return exe.empty() ? E_NOTIMPL : SHStrDupW((exe + L",0").c_str(), icon);
  }

  IFACEMETHODIMP GetToolTip(IShellItemArray*, LPWSTR* tip) override {
    *tip = nullptr;
    return E_NOTIMPL;
  }

  IFACEMETHODIMP GetCanonicalName(GUID* guid) override {
    *guid = clsid_;
    return S_OK;
  }

  IFACEMETHODIMP GetState(IShellItemArray*, BOOL, EXPCMDSTATE* state) override {
    *state = ECS_ENABLED;
    return S_OK;
  }

  IFACEMETHODIMP GetFlags(EXPCMDFLAGS* flags) override {
    *flags = ECF_DEFAULT;
    return S_OK;
  }

  IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand** commands) override {
    *commands = nullptr;
    return E_NOTIMPL;
  }

  IFACEMETHODIMP Invoke(IShellItemArray* items, IBindCtx*) override {
    if (items == nullptr) return E_INVALIDARG;
    const std::wstring command = ReadConfig(clsid_, L"Command");
    if (command.empty()) return E_FAIL;

    DWORD count = 0;
    HRESULT hr = items->GetCount(&count);
    if (FAILED(hr)) return hr;
    std::vector<std::wstring> paths;
    for (DWORD i = 0; i < count; ++i) {
      ComPtr<IShellItem> item;
      if (FAILED(items->GetItemAt(i, &item))) continue;
      PWSTR path = nullptr;
      // 只认文件系统里的条目（库、网络位置里的虚拟项没有路径）
      if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))) {
        paths.emplace_back(path);
        CoTaskMemFree(path);
      }
    }
    if (paths.empty()) return S_OK;

    std::wstring line = command + L" --compress";
    for (const auto& p : paths) line += L" " + QuoteArg(p);
    if (line.size() > kMaxCommandLine) {
      const std::wstring list = WriteList(paths);
      if (list.empty()) return E_FAIL;
      line = command + L" " + QuoteArg(L"--compress-list=" + list);
    }

    // 资源管理器在前台：允许 DevCube（含已在运行、收到转发的那个实例）把压缩窗口带到前台
    AllowSetForegroundWindow(ASFW_ANY);
    STARTUPINFOW startup = {sizeof(startup)};
    PROCESS_INFORMATION process = {};
    if (!CreateProcessW(nullptr, line.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr,
                        &startup, &process)) {
      return HRESULT_FROM_WIN32(GetLastError());
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return S_OK;
  }

 private:
  const GUID clsid_;
};

class CompressCommandFactory : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IClassFactory> {
 public:
  explicit CompressCommandFactory(const GUID& clsid) : clsid_(clsid) {}

  IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** object) override {
    *object = nullptr;
    if (outer != nullptr) return CLASS_E_NOAGGREGATION;
    auto command = Make<CompressCommand>(clsid_);
    return command ? command->QueryInterface(riid, object) : E_OUTOFMEMORY;
  }

  IFACEMETHODIMP LockServer(BOOL lock) override {
    auto& module = Module<InProc>::GetModule();
    if (lock) {
      module.IncrementObjectCount();
    } else {
      module.DecrementObjectCount();
    }
    return S_OK;
  }

 private:
  const GUID clsid_;
};

}  // namespace

STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, void** object) {
  *object = nullptr;
  // 只认应用登记过的 CLSID（键下有唤起命令）
  if (ReadConfig(clsid, L"Command").empty()) return CLASS_E_CLASSNOTAVAILABLE;
  auto factory = Make<CompressCommandFactory>(clsid);
  return factory ? factory->QueryInterface(riid, object) : E_OUTOFMEMORY;
}

STDAPI DllCanUnloadNow() {
  return Module<InProc>::GetModule().GetObjectCount() == 0 ? S_OK : S_FALSE;
}

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    DisableThreadLibraryCalls(module);
    // 建立 WRL 模块，对象计数（DllCanUnloadNow）才有依据
    Module<InProc>::GetModule();
  }
  return TRUE;
}
