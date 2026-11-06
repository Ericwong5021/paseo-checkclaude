// Headless driver for CheckClaude's browser signal probes.
//
// The menu bar app exposes no command line entry, so this binary is compiled from
// its own BrowserProbe and BrowserBridge classes and runs one of them on demand:
// collect the browser signals, write `browser_signals` for claude-check.sh, exit.
// Nothing stays resident and no launch agent is installed.
//
// Usage:
//   ccprobe --out <path> [--mode webview|browser] [--timeout <seconds>] [--open]
//
// Modes:
//   webview  hidden 1px WKWebView (default, silent, 2 to 5 seconds)
//   browser  serves a loopback page and waits for a real browser to post the full
//            fingerprint, including Client Hints and Sec-Fetch. Add --open to launch
//            the default browser automatically instead of printing the URL.
//
// Exit codes: 0 wrote signals, 2 probe failed, 3 timed out, 64 bad arguments.
import Cocoa
import Foundation

private struct Options {
  var outPath = ""
  var mode = "webview"
  var timeout: TimeInterval = 25
  var openBrowser = false
}

private func usage(_ message: String) -> Never {
  FileHandle.standardError.write("ccprobe: \(message)\n".data(using: .utf8)!)
  exit(64)
}

private func parseOptions() -> Options {
  var options = Options()
  var arguments = Array(CommandLine.arguments.dropFirst())
  while !arguments.isEmpty {
    let argument = arguments.removeFirst()
    switch argument {
    case "--out":
      guard !arguments.isEmpty else { usage("--out needs a path") }
      options.outPath = arguments.removeFirst()
    case "--mode":
      guard !arguments.isEmpty else { usage("--mode needs a value") }
      options.mode = arguments.removeFirst()
    case "--timeout":
      guard !arguments.isEmpty, let seconds = TimeInterval(arguments.removeFirst()) else {
        usage("--timeout needs a number")
      }
      options.timeout = seconds
    case "--open":
      options.openBrowser = true
    case "--help", "-h":
      print("usage: ccprobe --out <path> [--mode webview|browser] [--timeout seconds] [--open]")
      exit(0)
    default:
      usage("unknown argument \(argument)")
    }
  }
  if options.outPath.isEmpty { usage("--out is required") }
  if options.mode != "webview" && options.mode != "browser" {
    usage("--mode must be webview or browser")
  }
  return options
}

private let options = parseOptions()
private let startedAt = Date()
private var finished = false
private var bridge: BrowserBridge?
private var probe: BrowserProbe?

private func emit(_ status: String, _ detail: String?, code: Int32) -> Never {
  var payload: [String: Any] = [
    "mode": options.mode,
    "status": status,
    "out": options.outPath,
    "ms": Int(Date().timeIntervalSince(startedAt) * 1000),
  ]
  if let detail, !detail.isEmpty { payload["detail"] = detail }
  let data = (try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])) ?? Data()
  print(String(decoding: data, as: UTF8.self))
  fflush(stdout)
  exit(code)
}

private func finish(_ ok: Bool, _ detail: String?) -> Never {
  guard !finished else { exit(ok ? 0 : 2) }
  finished = true
  return emit(ok ? "ok" : "failed", detail, code: ok ? 0 : 2)
}

// Safety net: the probes have their own timers, this one covers a wedged run loop.
Timer.scheduledTimer(withTimeInterval: options.timeout, repeats: false) { _ in
  guard !finished else { return }
  finished = true
  emit("timeout", "probe exceeded \(Int(options.timeout))s", code: 3)
}

if options.mode == "browser" {
  // With --open, leaving `ready` nil makes BrowserBridge launch the default browser,
  // exactly like the menu bar app. Without it the URL is printed for the caller.
  let readyHandler: ((URL) -> Void)? = options.openBrowser
    ? nil
    : { url in
      FileHandle.standardError.write("ccprobe: waiting for \(url.absoluteString)\n".data(using: .utf8)!)
    }
  let bridgeInstance = BrowserBridge(
    outPath: options.outPath,
    activateBrowser: false,
    collected: { ok in finish(ok, ok ? nil : "browser did not post back in time") },
    cleanedUp: {},
    ready: readyHandler
  )
  bridge = bridgeInstance
  bridgeInstance.start()
} else {
  let probeInstance = BrowserProbe(outPath: options.outPath) { finish(true, nil) }
  probe = probeInstance
  probeInstance.run()
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
application.run()
