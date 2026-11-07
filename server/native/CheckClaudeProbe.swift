// BrowserProbe and BrowserBridge, copied verbatim from CheckClaude's menu bar app
// (menubar/StatusApp.swift, MIT, https://github.com/zzusec/CheckClaude) so the
// plugin can collect the same browser signals without the menu bar app running.
// Keep this file in sync with upstream when it changes.
import Cocoa
import Network
import WebKit
// 浏览器端信号采集: 用一个隐藏的 WKWebView 跑检测 JS，拿 shell 拿不到的那部分信号
// (WebRTC 泄漏 / Intl locale / 渲染指纹 / 字体 / Emoji)，结果写成 key=value 给 claude-check.sh 读。
//
// 注意: WKWebView 是 Safari 引擎，指纹与用户实际用的 Chrome 不完全一致；能反映的是
// "这台机器 + 这条网络"的环境画像，不是某个浏览器的完整指纹。
//
// WebRTC 是这里最有价值的一项: 它走 UDP，不经过 HTTP 代理，所以能暴露代理没兜住的真实出口。
final class BrowserProbe: NSObject, WKScriptMessageHandler {
    private var webView: WKWebView?
    private var window: NSWindow?
    private var timeout: Timer?
    private var done = false
    private var collected: [String: Any] = [:]
    private let outPath: String
    private let completion: () -> Void

    init(outPath: String, completion: @escaping () -> Void) {
        self.outPath = outPath
        self.completion = completion
        super.init()
    }

    func run() {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "cc")
        let wv = WKWebView(frame: NSRect(x: 0, y: 0, width: 1, height: 1), configuration: cfg)
        webView = wv
        // 离屏窗口: WKWebView 不在窗口层级里时，系统会把 setTimeout 节流到几十秒，
        // WebRTC 那段等不到结果。挂进一个屏幕外的 1px 窗口就恢复正常速度。
        let w = NSWindow(contentRect: NSRect(x: -10000, y: -10000, width: 1, height: 1),
                         styleMask: .borderless, backing: .buffered, defer: false)
        w.contentView = wv
        w.alphaValue = 0.01
        w.orderBack(nil)
        window = w
        wv.loadHTMLString(Self.html, baseURL: URL(string: "https://local.probe/"))
        // JS 卡住(STUN 不通等)时兜底，别让菜单一直等
        timeout = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.collected["rtc_timeout"] = "1"
            let rtc = String(describing: self.collected["rtc_status"] ?? "")
            if rtc.isEmpty || rtc == "collecting" { self.collected["rtc_status"] = "timeout" }
            self.finish(self.collected)
        }
    }

    func userContentController(_ c: WKUserContentController, didReceive msg: WKScriptMessage) {
        guard let d = msg.body as? [String: Any] else { return finish(["error": "返回格式异常"]) }
        collected.merge(d) { _, new in new }
        // JS 分两次发: 第一次是同步信号(语言/时区/指纹)，第二次带 WebRTC 结果。
        // 先落盘一次，这样即便 STUN 不通也不会丢掉已拿到的信号。
        if d["phase"] as? String == "final" { finish(collected) } else { write(collected) }
    }

    private func write(_ dict: [String: Any]) {
        var txt = "time=\(Int(Date().timeIntervalSince1970))\n"
        for (k, v) in dict.sorted(by: { $0.key < $1.key }) {
            txt += "\(k)=\(String(describing: v).replacingOccurrences(of: "\n", with: " "))\n"
        }
        try? txt.write(toFile: outPath, atomically: true, encoding: .utf8)
    }

    private func finish(_ dict: [String: Any]) {
        guard !done else { return }
        done = true
        timeout?.invalidate()
        write(dict)
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "cc")
        window?.close(); window = nil
        webView = nil
        completion()
    }

    private static let html = """
    <!doctype html><meta charset="utf-8"><body><script>
    (async () => {
      const out = {};
      const send = (phase) => {
        out.phase = phase;
        try { webkit.messageHandlers.cc.postMessage(out); } catch(e){}
      };
      try {
        // ── 浏览器身份画像 ──
        out.source = 'webview';
        out.ua_js = navigator.userAgent || '';
        out.languages = (navigator.languages || []).join(',');
        const ro = Intl.DateTimeFormat().resolvedOptions();
        out.tz = ro.timeZone || '';
        out.locale = ro.locale || '';
        out.tzoffset = String(-new Date().getTimezoneOffset() / 60);
        out.platform = navigator.platform || '';
        out.hw = String(navigator.hardwareConcurrency || '');

        // ── 终端环境指纹: 渲染特征 ──
        try {
          const c = document.createElement('canvas'), x = c.getContext('2d');
          x.textBaseline = 'top'; x.font = '14px Arial';
          x.fillText('Claude环境检测', 2, 2);
          const d = c.toDataURL();
          let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) | 0;
          out.canvas = (h >>> 0).toString(16);
        } catch (e) { out.canvas = ''; }
        try {
          const gl = document.createElement('canvas').getContext('webgl');
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          out.webgl = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
        } catch (e) { out.webgl = ''; }
        // Emoji 风格: 苹果彩色字形与开源字形的绘制宽度不同，可粗判是不是原生 macOS 渲染
        try {
          const c = document.createElement('canvas'), x = c.getContext('2d');
          x.font = '16px sans-serif';
          out.emojiw = String(Math.round(x.measureText('\\u{1F600}').width * 10) / 10);
        } catch (e) { out.emojiw = ''; }

        // ── 字体探测: 装了哪些中文字体(国产终端弱信号) ──
        try {
          const probe = ['PingFang SC','Hiragino Sans GB','Microsoft YaHei','SimSun','Songti SC','STHeiti'];
          const s = document.createElement('span');
          s.style.cssText = 'position:absolute;left:-9999px;font-size:72px';
          s.textContent = 'mmmmmmmmmmlli测试';
          document.body.appendChild(s);
          s.style.fontFamily = 'monospace'; const base = s.offsetWidth;
          out.fonts = probe.filter(f => {
            s.style.fontFamily = "'" + f + "',monospace";
            return s.offsetWidth !== base;
          }).join(',');
          s.remove();
        } catch (e) { out.fonts = ''; }

        send('sync');   // 同步信号先落盘，网络探测或 WebRTC 慢时也不会连累它们

        // ── 浏览器侧 Claude 服务可达性 ──
        // shell curl 和真实浏览器可能走不同的 PAC/扩展代理；这里只判断传输路径能否完成，
        // no-cors 看不到 401/403，不能替代 shell 侧的地区拦截判定。
        const reachOne = async (key, url) => {
          const started = performance.now(), ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 3500);
          try {
            await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
            out['reach_' + key] = 'ok';
            out['reach_' + key + '_ms'] = String(Math.round(performance.now() - started));
          } catch (e) {
            out['reach_' + key] = e && e.name === 'AbortError' ? 'timeout' : 'error';
            out['reach_' + key + '_ms'] = '';
          } finally { clearTimeout(timer); }
        };
        // 不探 claude.ai: 它拒绝一切跨站子资源请求(fetch/img)，在任何第三方页面里都恒 error，
        // 与本机链路无关(顶层导航是正常的)。可达性以 shell 侧 curl robots.txt 为准。
        const reachPromise = Promise.all([
          reachOne('anthropic', 'https://www.anthropic.com/'),
          reachOne('api', 'https://api.anthropic.com/')
        ]);

        // ── WebRTC 泄漏: 明确区分无泄漏、超时、异常和不支持 ──
        out.rtc_host = ''; out.rtc_srflx = ''; out.rtc_candidate_count = '0';
        out.rtc_public_count = '0'; out.rtc_supported = '0'; out.rtc_status = 'unsupported';
        if ('RTCPeerConnection' in window) {
          out.rtc_supported = '1'; out.rtc_status = 'collecting';
          const rtcStarted = performance.now();
          try {
            const pc = new RTCPeerConnection({ iceServers: [
              { urls: 'stun:stun.cloudflare.com:3478' },
              { urls: 'stun:stun.l.google.com:19302' }
            ]});
            pc.createDataChannel('probe');
            const hosts = new Set(), srflx = new Set();
            let candidates = 0, completed = false, finishGathering;
            const gathered = new Promise(r => { finishGathering = r; });
            pc.onicecandidate = e => {
              if (!e.candidate) { completed = true; finishGathering(); return; }
              candidates += 1;
              const c = e.candidate.candidate;
              const m = c.match(/([0-9]{1,3}(?:\\.[0-9]{1,3}){3})/);
              if (!m) return;
              if (c.indexOf('typ host') >= 0) hosts.add(m[1]);
              if (c.indexOf('typ srflx') >= 0) srflx.add(m[1]);
            };
            pc.onicegatheringstatechange = () => {
              if (pc.iceGatheringState === 'complete') { completed = true; finishGathering(); }
            };
            await pc.setLocalDescription(await pc.createOffer());
            await Promise.race([gathered, new Promise(r => setTimeout(r, 4500))]);
            out.rtc_host = [...hosts].join(',');
            out.rtc_srflx = [...srflx].join(',');
            out.rtc_candidate_count = String(candidates);
            out.rtc_public_count = String(srflx.size);
            out.rtc_elapsed_ms = String(Math.round(performance.now() - rtcStarted));
            out.rtc_status = srflx.size > 0 ? 'ok' : (completed ? 'none' : 'timeout');
            pc.close();
          } catch (e) {
            out.rtc_status = 'error';
            out.rtc_elapsed_ms = String(Math.round(performance.now() - rtcStarted));
            out.rtc_err = String(e).slice(0, 60);
          }
        }
        await reachPromise;
      } catch (e) {
        out.error = String(e).slice(0, 100);
      }
      send('final');
    })();
    </script></body>
    """
}


// 真实浏览器指纹采集: 起一个只听 127.0.0.1 的极简 HTTP server，用 open 唤起用户的默认浏览器
// 来访问它。WKWebView 是 Safari 引擎，拿不到 Client Hints / Sec-Fetch，也不是用户真正登录
// claude.ai 时用的那个浏览器；走这条路采到的才是 Anthropic 网页端实际看到的指纹。
//
// 安全: 只绑 127.0.0.1、随机端口、URL 带一次性 token、拿到结果或 90 秒超时立即关闭监听。
final class BrowserBridge {
    private var listener: NWListener?
    private var collectionTimeout: Timer?
    private var cleanupTimer: Timer?
    private let token = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)
    private let outPath: String
    private let activateBrowser: Bool
    private let collected: (Bool) -> Void
    private let cleanedUp: () -> Void
    private let ready: ((URL) -> Void)?
    private var collectionDelivered = false
    private var cleaned = false
    private var reportData: Data?

    init(outPath: String, activateBrowser: Bool = false,
         collected: @escaping (Bool) -> Void,
         cleanedUp: @escaping () -> Void, ready: ((URL) -> Void)? = nil) {
        self.outPath = outPath
        self.activateBrowser = activateBrowser
        self.collected = collected
        self.cleanedUp = cleanedUp
        self.ready = ready
    }

    func start() {
        do {
            // 必须显式绑到 127.0.0.1。NWParameters.tcp + on:.any 会监听 0.0.0.0，
            // macOS 15 起这属于「本地网络」访问，未授权时浏览器连不上来，
            // 浏览器组信号会整组掉到中性分；纯 loopback 则豁免该权限。
            let params = NWParameters.tcp
            params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: .any)
            params.allowLocalEndpointReuse = true
            let l = try NWListener(using: params)
            l.newConnectionHandler = { [weak self] connection in self?.handle(connection) }
            l.stateUpdateHandler = { [weak self] state in
                guard case .ready = state, let self, let port = self.listener?.port else { return }
                let url = "http://127.0.0.1:\(port.rawValue)/c?t=\(self.token)"
                guard let reportURL = URL(string: url) else { return }
                if let ready = self.ready {
                    ready(reportURL)
                } else {
                    let config = NSWorkspace.OpenConfiguration()
                    config.activates = self.activateBrowser
                    config.addsToRecentItems = false
                    NSWorkspace.shared.open(reportURL, configuration: config, completionHandler: nil)
                }
            }
            listener = l
            l.start(queue: .main)
            collectionTimeout = Timer.scheduledTimer(withTimeInterval: 90, repeats: false) { [weak self] _ in
                self?.deliverCollection(false)
                self?.cleanup()
            }
        } catch {
            deliverCollection(false)
            cleanup()
        }
    }

    func publishReport(_ payload: [String: Any]) {
        guard !cleaned, JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
        reportData = data
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: .main)
        receiveRequest(connection, buffer: Data())
    }

    private func receiveRequest(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self else { connection.cancel(); return }
            var accumulated = buffer
            if let data { accumulated.append(data) }
            if self.requestIsComplete(accumulated) {
                self.processRequest(connection, data: accumulated)
            } else if error == nil, !isComplete, accumulated.count < 262144 {
                self.receiveRequest(connection, buffer: accumulated)
            } else {
                connection.cancel()
            }
        }
    }

    private func requestIsComplete(_ data: Data) -> Bool {
        let separator = Data("\r\n\r\n".utf8)
        guard let range = data.range(of: separator),
              let header = String(data: data[..<range.lowerBound], encoding: .utf8) else { return false }
        let contentLength = header.components(separatedBy: "\r\n").compactMap { line -> Int? in
            let parts = line.split(separator: ":", maxSplits: 1).map(String.init)
            guard parts.count == 2, parts[0].lowercased() == "content-length" else { return nil }
            return Int(parts[1].trimmingCharacters(in: .whitespaces))
        }.first ?? 0
        return data.count >= range.upperBound + contentLength
    }

    private func processRequest(_ connection: NWConnection, data: Data) {
        let separator = Data("\r\n\r\n".utf8)
        guard let range = data.range(of: separator),
              let header = String(data: data[..<range.lowerBound], encoding: .utf8) else {
            respond(connection, 400, "text/plain; charset=utf-8", Data("bad request".utf8)); return
        }
        let lines = header.components(separatedBy: "\r\n")
        let requestLine = lines.first ?? ""
        let parts = requestLine.split(separator: " ").map(String.init)
        guard parts.count >= 2 else {
            respond(connection, 400, "text/plain; charset=utf-8", Data("bad request".utf8)); return
        }
        let method = parts[0], target = parts[1]
        let suppliedToken = URLComponents(string: target)?.queryItems?.first(where: { $0.name == "t" })?.value
        guard suppliedToken == String(token) else {
            respond(connection, 403, "text/plain; charset=utf-8", Data("forbidden".utf8)); return
        }

        if method == "POST", target.hasPrefix("/r?") {
            let bodyData = data.subdata(in: range.upperBound..<data.count)
            let body = String(data: bodyData, encoding: .utf8) ?? ""
            save(headers: lines, body: body)
            respond(connection, 200, "text/plain; charset=utf-8", Data("ok".utf8))
            deliverCollection(true)
            scheduleCleanup()
        } else if method == "GET", target.hasPrefix("/report?") {
            if let reportData {
                respond(connection, 200, "application/json; charset=utf-8", reportData)
            } else {
                respond(connection, 202, "application/json; charset=utf-8", Data("{\"ready\":false}".utf8))
            }
        } else if method == "POST", target.hasPrefix("/close?") {
            respond(connection, 200, "text/plain; charset=utf-8", Data("closed".utf8)) { [weak self] in
                self?.cleanup()
            }
        } else if method == "GET" {
            respond(connection, 200, "text/html; charset=utf-8", Data(Self.page(token: String(token)).utf8))
        } else {
            respond(connection, 404, "text/plain; charset=utf-8", Data("not found".utf8))
        }
    }

    private func respond(_ connection: NWConnection, _ code: Int, _ type: String, _ body: Data,
                         completion: (() -> Void)? = nil) {
        let reason: String
        switch code {
        case 200: reason = "OK"
        case 202: reason = "Accepted"
        case 400: reason = "Bad Request"
        case 403: reason = "Forbidden"
        default: reason = "Not Found"
        }
        var headers = "HTTP/1.1 \(code) \(reason)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\n"
        headers += "Cache-Control: no-store, max-age=0\r\nPragma: no-cache\r\nReferrer-Policy: no-referrer\r\n"
        headers += "X-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\n"
        if type.hasPrefix("text/html") {
            headers += "Content-Security-Policy: default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' https://claude.ai https://www.anthropic.com https://api.anthropic.com; img-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\r\n"
        }
        headers += "Connection: close\r\n\r\n"
        connection.send(content: Data(headers.utf8) + body, completion: .contentProcessed { _ in
            connection.cancel()
            if let completion { DispatchQueue.main.async(execute: completion) }
        })
    }

    private func save(headers: [String], body: String) {
        var output: [String: String] = ["source": "browser"]
        let wanted = ["user-agent": "ua", "accept-language": "accept_lang",
                      "sec-ch-ua": "ch_ua", "sec-ch-ua-platform": "ch_platform",
                      "sec-ch-ua-mobile": "ch_mobile", "sec-fetch-site": "sf_site",
                      "sec-fetch-mode": "sf_mode", "sec-fetch-dest": "sf_dest"]
        for header in headers.dropFirst() {
            guard let index = header.firstIndex(of: ":") else { continue }
            let key = header[..<index].lowercased()
            let value = header[header.index(after: index)...].trimmingCharacters(in: .whitespaces)
            if let mapped = wanted[String(key)] {
                output[mapped] = value.replacingOccurrences(of: "\"", with: "")
            }
        }
        for pair in body.components(separatedBy: "\n") {
            guard let index = pair.firstIndex(of: "=") else { continue }
            output[String(pair[..<index])] = String(pair[pair.index(after: index)...])
        }
        var text = "time=\(Int(Date().timeIntervalSince1970))\n"
        for (key, value) in output.sorted(by: { $0.key < $1.key }) {
            text += "\(key)=\(value.replacingOccurrences(of: "\n", with: " "))\n"
        }
        try? text.write(toFile: outPath, atomically: true, encoding: .utf8)
    }

    private func deliverCollection(_ ok: Bool) {
        guard !collectionDelivered else { return }
        collectionDelivered = true
        collectionTimeout?.invalidate(); collectionTimeout = nil
        collected(ok)
    }

    private func scheduleCleanup() {
        cleanupTimer?.invalidate()
        cleanupTimer = Timer.scheduledTimer(withTimeInterval: 10 * 60, repeats: false) { [weak self] _ in
            self?.cleanup()
        }
    }

    private func cleanup() {
        guard !cleaned else { return }
        cleaned = true
        collectionTimeout?.invalidate(); cleanupTimer?.invalidate()
        listener?.cancel(); listener = nil
        cleanedUp()
    }

    static func page(token: String) -> String {
        return """
        <!doctype html>
        <html lang="zh-CN"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>CheckClaude 完整环境体检</title>
        <style>
        :root{color-scheme:light dark;--bg:#f5f6f8;--surface:#fff;--surface2:#f8f9fb;--text:#172033;--muted:#667085;--line:#dfe3ea;--good:#08783e;--goodbg:#eaf8f0;--caution:#806000;--cautionbg:#fff8cf;--warn:#9a5700;--warnbg:#fff4dc;--bad:#b42318;--badbg:#fff0ee;--info:#175cd3;--infobg:#eef4ff;--accent:#315efb}
        @media(prefers-color-scheme:dark){:root{--bg:#0c111b;--surface:#151c28;--surface2:#1b2432;--text:#f4f6fb;--muted:#aab4c4;--line:#2d394b;--good:#72d69b;--goodbg:#123526;--caution:#f5dc74;--cautionbg:#3a3210;--warn:#f6c76d;--warnbg:#3c2c10;--bad:#ff9b91;--badbg:#451d1d;--info:#9cc2ff;--infobg:#172e55;--accent:#7ca4ff}}
        *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button{font:inherit}
        main{width:min(1120px,calc(100% - 32px));margin:36px auto 80px}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:22px}.brand{font-size:13px;font-weight:750;letter-spacing:.08em;color:var(--accent)}h1{margin:5px 0 6px;font-size:clamp(27px,4vw,42px);line-height:1.15;letter-spacing:-.03em}.lead{margin:0;color:var(--muted)}
        .close{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:10px;padding:9px 14px;cursor:pointer}.close:hover{border-color:var(--accent)}
        .status{display:flex;align-items:center;gap:10px;margin:18px 0;padding:13px 15px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.spinner{width:16px;height:16px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
        .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.metric{padding:17px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.metric b{display:block;font-size:25px;line-height:1.2}.metric span{display:block;margin-top:5px;color:var(--muted);font-size:12px}.metric.good{border-color:var(--good);background:var(--goodbg)}.metric.caution{color:var(--caution);border-color:var(--caution);background:var(--cautionbg)}.metric.warn{border-color:var(--warn);background:var(--warnbg)}.metric.bad{border-color:var(--bad);background:var(--badbg)}
        .verdict{margin:0 0 18px;padding:17px 19px;border-radius:14px;background:var(--surface);border:1px solid var(--line);font-weight:650}
        section{margin-top:16px;border:1px solid var(--line);border-radius:15px;background:var(--surface);overflow:hidden}section h2{margin:0;padding:15px 18px 12px;font-size:17px}section .desc{margin:-8px 18px 12px;color:var(--muted);font-size:13px}.rows{border-top:1px solid var(--line)}.row{display:grid;grid-template-columns:minmax(150px,230px) 1fr;gap:18px;padding:11px 18px;border-top:1px solid var(--line)}.row:first-child{border-top:0}.key{color:var(--muted)}.value{min-width:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
        .pill{display:inline-flex;align-items:center;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:750}.good{color:var(--good);background:var(--goodbg)}.caution{color:var(--caution);background:var(--cautionbg)}.warn{color:var(--warn);background:var(--warnbg)}.bad{color:var(--bad);background:var(--badbg)}.neutral{color:var(--info);background:var(--infobg)}
        .matrix{display:grid;grid-template-columns:1.15fr auto 2fr;gap:0;border-top:1px solid var(--line)}.matrix>div{padding:11px 16px;border-top:1px solid var(--line)}.matrix>div:nth-child(-n+3){border-top:0}.matrix .detail{color:var(--muted)}
        .signal-table{width:100%;border-collapse:collapse}.signal-table th,.signal-table td{text-align:left;padding:10px 13px;border-top:1px solid var(--line);vertical-align:top}.signal-table th{color:var(--muted);font-size:12px}.signal-table td:last-child,.signal-table th:last-child{text-align:right;white-space:nowrap}.signal-table .miss{color:var(--bad);font-weight:700}.signal-table .full{color:var(--good)}
        ul{margin:0;padding:0 0 0 20px}li+li{margin-top:7px}.note{color:var(--muted);font-size:13px}.footer{margin-top:22px;color:var(--muted);font-size:13px;text-align:center}
        @media(max-width:760px){main{width:min(100% - 20px,1120px);margin-top:20px}.top{display:block}.close{margin-top:14px}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.row{grid-template-columns:1fr;gap:3px}.matrix{grid-template-columns:1fr}.matrix>div{border-top:0}.matrix>div:nth-child(3n){padding-top:3px;padding-bottom:14px;border-bottom:1px solid var(--line)}.signal-table{font-size:13px}.signal-table th:nth-child(1),.signal-table td:nth-child(1){display:none}}
        @media(prefers-reduced-motion:reduce){.spinner{animation:none}}
        </style></head><body><main>
        <div class="top"><div><div class="brand">CHECKCLAUDE · 本机隐私检测</div><h1>Claude 完整环境体检</h1><p class="lead">浏览器、系统、出口、DNS 与网络路径的一致性报告</p></div><button id="close" class="close" type="button">关闭页面</button></div>
        <div id="status" class="status"><span class="spinner"></span><span>正在采集浏览器信号…</span></div>
        <div id="content"></div><p class="footer">检测数据只在本机 CheckClaude 与当前浏览器标签页之间传递，不上传检测报告。</p>
        </main><script>
        (() => {
          const TOKEN = "\(token)";
          const status = document.getElementById("status"), content = document.getElementById("content");
          const o = {};
          const set = (k,v) => { o[k] = String(v == null ? "" : v).replace(/\\n/g," "); };
          const txt = (v,f="未采集") => v == null || v === "" || v === "?" ? f : String(v);
          const element = (tag, cls, value) => { const e=document.createElement(tag); if(cls)e.className=cls; if(value!=null)e.textContent=String(value); return e; };
          const duration = v => { const n=Number(v); if(!Number.isFinite(n)||n<0)return "—"; return n<1?Math.round(n*1000)+"ms":n.toFixed(2)+"s"; };
          const list = v => txt(v,"").split("|").filter(Boolean);
          const section = (title, description="") => { const s=element("section"); s.append(element("h2","",title)); if(description)s.append(element("p","desc",description)); const rows=element("div","rows"); s.append(rows); content.append(s); return rows; };
          const addRow = (rows,key,value,mono=false) => { const r=element("div","row"); r.append(element("div","key",key),element("div","value"+(mono?" mono":""),txt(value))); rows.append(r); };
          const addListSection = (title, values, empty) => { const rows=section(title); const box=element("div","row"); box.append(element("div","key",title)); const value=element("div","value"); if(values.length){const ul=element("ul"); values.forEach(v=>ul.append(element("li","",v))); value.append(ul);}else value.textContent=empty; box.append(value); rows.append(box); };
          const tone = state => state==="good"?"good":state==="bad"?"bad":state==="warn"?"warn":"neutral";
          const stateLabel = state => state==="good"?"一致":state==="bad"?"冲突":state==="warn"?"需关注":"数据不足";
          const matrix = (host,label,state,detail) => { host.append(element("div","",label)); const b=element("div","pill "+tone(state),stateLabel(state)); host.append(b,element("div","detail",detail)); };
          const splitIPs = v => txt(v,"").split(",").map(x=>x.trim()).filter(Boolean);
          const sameIP = (a,b) => !!a && !!b && splitIPs(a).includes(b);
          const hash = value => { let h=2166136261; for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);} return (h>>>0).toString(16).padStart(8,"0"); };
          const browserName = ua => ua.includes("Edg/")?"Microsoft Edge":ua.includes("OPR/")?"Opera":ua.includes("Chrome/")?"Chrome":ua.includes("Safari/")&&!ua.includes("Chrome/")?"Safari":ua.includes("Firefox/")?"Firefox":/MicroMessenger/i.test(ua)?"微信内置浏览器":"未知浏览器";
          const osName = ua => /Windows NT/i.test(ua)?"Windows":/Android/i.test(ua)?"Android":/iPhone|iPad/i.test(ua)?"iOS":/Macintosh|Mac OS/i.test(ua)?"macOS":/Linux/i.test(ua)?"Linux":navigator.platform||"未知";
          const escapeClose = () => { try { navigator.sendBeacon("/close?t="+TOKEN, ""); } catch(e){} };
          window.addEventListener("beforeunload", escapeClose);
          document.getElementById("close").onclick = () => { escapeClose(); window.close(); setTimeout(()=>{status.textContent="报告已完成，可以手动关闭此标签页。";},300); };

          function renderWaiting(){
            content.replaceChildren(); const rows=section("浏览器阶段已完成","正在等待本机系统、出口、DNS 与 Claude 连通性检测。");
            addRow(rows,"浏览器",txt(o.browser_name)); addRow(rows,"平台",txt(o.os_name)+" · "+txt(o.platform));
            addRow(rows,"浏览器时区",txt(o.tz)+" · UTC"+(Number(o.tzoffset)>=0?"+":"")+txt(o.tzoffset));
            addRow(rows,"语言 / Locale",txt(o.languages)+" · "+txt(o.locale));
            addRow(rows,"WebRTC",o.rtc_status==="ok"?txt(o.rtc_srflx):txt(o.rtc_status));
            addRow(rows,"运行容器",txt(o.runtime_flags,"未发现自动化或内嵌容器特征"));
          }

          function parseSignals(raw){
            const rows=[], parts=txt(raw,"").split(";"); let current="";
            parts.forEach(part=>{ if((part.match(/~/g)||[]).length>=4){ if(current)rows.push(current); current=part; } else if(current){ current+=";"+part; } });
            if(current)rows.push(current);
            return rows.map(row=>{const f=row.split("~"); return {group:f[0],label:f[1],weight:Number(f[2]||0),points:Number(f[3]||0),value:f.slice(4).join("~")};});
          }

          function renderReport(report){
            const c=report.claude||{}, n=report.network||{}, b=report.browser||o, q=report.quality||{};
            document.title="CheckClaude v"+txt(report.version,"?")+" 完整体检报告";
            const countdownText=element("span","","完整报告已生成，页面将在 5 秒后自动关闭。"), keepOpen=element("button","close","保持打开");
            status.replaceChildren(element("span","pill good","检测完成"),countdownText,keepOpen);
            let remaining=5, closeCancelled=false;
            const closeTimer=setInterval(()=>{
              if(closeCancelled){clearInterval(closeTimer);return;}
              remaining-=1;
              if(remaining<=0){
                clearInterval(closeTimer);escapeClose();window.close();
                setTimeout(()=>{countdownText.textContent="浏览器阻止了自动关闭，请手动关闭此标签页。";keepOpen.remove();},400);
              }else countdownText.textContent="完整报告已生成，页面将在 "+remaining+" 秒后自动关闭。";
            },1000);
            keepOpen.onclick=()=>{closeCancelled=true;clearInterval(closeTimer);countdownText.textContent="已取消自动关闭，可继续查看报告。";keepOpen.remove();};
            content.replaceChildren();
            const score=Number(c.score||0), safe=c.safeuse==="1";
            const routeKnown=c.probe_state ? c.probe_state==="ok" : (c.consistent==="0"||c.consistent==="1");
            const routeLabel=routeKnown?(c.consistent==="1"?"三路一致":"三路不一致"):"通过（未识别）";
            const routeClass=routeKnown?(c.consistent==="1"?"good":"bad"):"good";
            const routeDetail=routeKnown?(c.consistent==="1"?"国内、国外与谷歌侧出口一致":"检测到分流、PAC或不同出口"):"暂未识别，按通过处理，不扣分";
            const riskLevel=txt(c.risklevel||c.grade),riskClass=riskLevel==="安全"?"good":riskLevel==="低风险"?"caution":riskLevel==="中风险"?"warn":riskLevel==="待复测"?"neutral":"bad";
            const summary=element("div","summary");
            [[score+" / 100","环境得分",riskClass],[riskLevel,"使用风险",riskClass],[txt(c.country),"出口国家",""],[routeLabel,"出口状态",routeClass]].forEach(x=>{const m=element("div","metric "+(x[2]||""));m.append(element("b","",x[0]),element("span","",x[1]));summary.append(m);});
            content.append(summary,element("div","verdict "+(safe?"good":score>=70?"warn":"bad"),txt(c.verdict)));
            if(c.route_notice)content.append(element("p","desc",c.route_notice));

            const matrixSection=element("section"); matrixSection.append(element("h2","","信号一致性矩阵"),element("p","desc","比单项数量更重要的是出口、系统和浏览器彼此是否自洽。")); const matrixHost=element("div","matrix"); matrixSection.append(matrixHost); content.append(matrixSection);
            matrix(matrixHost,"三路出口",routeClass,routeDetail);
            matrix(matrixHost,"系统时区 ↔ 出口时区",c.systz&&c.iptz&&c.systz===c.iptz?"good":c.iptz&&c.iptz!=="?"?"bad":"neutral",txt(c.systz)+" ↔ "+txt(c.iptz));
            matrix(matrixHost,"浏览器时区 ↔ 出口时区",b.tz&&c.iptz&&b.tz===c.iptz?"good":b.tz&&c.iptz?"bad":"neutral",txt(b.tz)+" ↔ "+txt(c.iptz));
            matrix(matrixHost,"WebRTC ↔ 权威出口",b.rtc_status==="none"?"good":b.rtc_status==="ok"?(sameIP(b.rtc_srflx,n.gfw||c.ip)?"good":"bad"):"neutral",b.rtc_status==="none"?"无公网候选":txt(b.rtc_srflx)+" ↔ "+txt(n.gfw||c.ip));
            matrix(matrixHost,"IPv6 ↔ IPv4 国家",c.ipv6==="无"?"good":c.ipv6country&&c.country&&c.ipv6country===c.country?"good":c.ipv6country&&c.ipv6country!=="?"?"bad":"neutral",txt(c.ipv6)+" · "+txt(c.ipv6country));
            matrix(matrixHost,"HTTP/JS 浏览器画像",c.brheaders==="ok"?"good":c.brheaders==="conflict"?"bad":"neutral",txt(c.brheaders));
            matrix(matrixHost,"DNS 解析",/^(正常|代理接管)/.test(c.dnsresult||"")?"good":/污染|失败/.test(c.dnsresult||"")?"bad":"warn",txt(c.dnsresult)+" · "+txt(c.dnsanswer));
            matrix(matrixHost,"shell ↔ 浏览器连通性",b.reach_api==="ok"&&c.api&&c.api!=="000"?"good":b.reach_api&&b.reach_api!=="ok"?"bad":"neutral","API shell HTTP "+txt(c.api)+" · 浏览器 "+txt(b.reach_api));
            const changes=Number(c.ipchanges||0); matrix(matrixHost,"出口 IP 稳定性",changes<=1?"good":changes<=5?"warn":"bad","24 小时内确认变化 "+changes+" 次 · "+(changes<=1?"建议继续固定当前出口":"请关闭自动切换并固定单一出口"));

            let rows=section("出口与 IP","真实系统探测，不依赖单一浏览器接口。");
            addRow(rows,"权威出口 IP",n.timezone_ip||n.gfw||c.ip,true); addRow(rows,"国内视角",n.cn,true); addRow(rows,"国外视角",n.intl,true); addRow(rows,"谷歌侧",n.gfw,true);
            addRow(rows,"国家 / 城市",txt(c.countryname)+" · "+txt(c.country)+" · "+txt(c.city)); addRow(rows,"ISP / ASN",txt(c.isp)+" · "+txt(c.asn)); addRow(rows,"IP 类型",c.iptype); addRow(rows,"经纬度",txt(c.latitude)+", "+txt(c.longitude));
            addRow(rows,"多源情报",txt(c.intelsources)+" · "+txt(c.intelcount,"0")+" 个来源"); addRow(rows,"IPv6",txt(c.ipv6)+" · "+txt(c.ipv6country));
            addRow(rows,"Cloudflare",txt(c.cfip)+" · "+txt(c.colo)+" / "+txt(c.cfloc)+" · WARP "+txt(c.cfwarp)); addRow(rows,"代理形态",c.proxymode);

            rows=section("时区、区域与语言"); addRow(rows,"出口 IANA 时区",c.iptz); addRow(rows,"系统时区",c.systz); addRow(rows,"浏览器时区",b.tz); addRow(rows,"UTC 偏移",txt(c.tzoffset)+" · 浏览器 UTC"+(Number(b.tzoffset)>=0?"+":"")+txt(b.tzoffset));
            addRow(rows,"系统区域 / 语言",txt(c.locale)+" · "+txt(c.langs)); addRow(rows,"Intl Locale",b.locale); addRow(rows,"浏览器语言",b.languages); addRow(rows,"语言变体",b.language_variant); addRow(rows,"Emoji 风格",b.emoji_style);

            rows=section("WebRTC 与泄漏面"); addRow(rows,"探测状态",b.rtc_status); addRow(rows,"srflx 公网出口",txt(b.rtc_srflx,"无"),true); addRow(rows,"host 候选",txt(b.rtc_host,"无"),true); addRow(rows,"候选 / 公网候选",txt(b.rtc_candidate_count,"0")+" / "+txt(b.rtc_public_count,"0")); addRow(rows,"耗时 / 错误",txt(b.rtc_elapsed_ms,"—")+"ms · "+txt(b.rtc_err,"无"));

            rows=section("DNS"); addRow(rows,"实际 DNS 服务器",c.dnsservers,true); addRow(rows,"DNS 作用域",c.dns); addRow(rows,"claude.ai 解析",c.dnsanswer,true); addRow(rows,"判定",c.dnsresult);

            rows=section("Claude 连通性"); addRow(rows,"Anthropic API（shell）","HTTP "+txt(c.api)); addRow(rows,"claude.ai（shell）","HTTP "+txt(c.web)); addRow(rows,"anthropic.com（shell）","HTTP "+txt(c.site));
            addRow(rows,"claude.ai（浏览器）",txt(b.reach_claude)+" · "+txt(b.reach_claude_ms,"—")+"ms"); addRow(rows,"anthropic.com（浏览器）",txt(b.reach_anthropic)+" · "+txt(b.reach_anthropic_ms,"—")+"ms"); addRow(rows,"API（浏览器）",txt(b.reach_api)+" · "+txt(b.reach_api_ms,"—")+"ms"); addRow(rows,"Claude Code",txt(c.claudever)+" · "+txt(c.base));

            rows=section("浏览器、设备与运行容器"); addRow(rows,"浏览器 / 系统",txt(b.browser_name)+" · "+txt(b.os_name)+" · "+txt(b.device_type)); addRow(rows,"JavaScript UA",b.ua_js,true); addRow(rows,"HTTP User-Agent",b.ua,true); addRow(rows,"Client Hints",txt(b.uad_platform)+" · "+txt(b.uad_arch)+" · "+txt(b.uad_brands));
            addRow(rows,"运行容器",txt(b.runtime_flags,"未发现自动化或内嵌容器特征")); addRow(rows,"屏幕",txt(b.screen)+" · DPR "+txt(b.pixel_ratio)); addRow(rows,"硬件",txt(b.hardware_concurrency)+" 核 · 内存 "+txt(b.device_memory,"未知")+"GB · 触控点 "+txt(b.max_touch_points,"0"));
            addRow(rows,"隐私 / 存储","Cookie "+txt(b.cookie_enabled)+" · LocalStorage "+txt(b.local_storage)+" · DNT "+txt(b.dnt)); addRow(rows,"插件 / MIME",txt(b.plugins_count,"0")+" / "+txt(b.mime_types_count,"0"));
            addRow(rows,"Network Information",txt(b.connection_type)+" · RTT "+txt(b.connection_rtt,"—")+"ms · 下行 "+txt(b.connection_downlink,"—")+"Mbps · 省流 "+txt(b.connection_save_data));
            addRow(rows,"WebGL Vendor",b.webgl_vendor); addRow(rows,"WebGL Renderer",b.webgl_renderer); addRow(rows,"Canvas Hash",b.canvas,true); addRow(rows,"中文字体",txt(b.fonts,"无")); addRow(rows,"厂商字体",txt(b.fonts_vendor,"无"));

            rows=section("线路质量","最近 24 小时成功率与本次 TCP、TLS、TTFB、总耗时。");
            [["cn","国内"],["intl","国外"],["gfw","谷歌侧"],["google","Google 204"]].forEach(([key,label])=>{const v=q[key]||{};addRow(rows,label,txt(v.successRate,"0")+"% 成功 · 失败 "+txt(v.failures,"0")+" · TCP "+duration(v.connect)+" · TLS "+duration(v.tls)+" · TTFB "+duration(v.ttfb)+" · 总耗时 "+duration(v.total)+" · 抖动 "+duration(v.jitter)+" · HTTP "+txt(v.http));});

            const signals=parseSignals(c.signals); const signalSection=element("section"); signalSection.append(element("h2","","26 项加权评分明细"),element("p","desc","新增浏览器诊断只作为证据展示；安全档位仍由经过测试的 100 分模型决定。")); const table=element("table","signal-table"); const head=element("tr");["分组","检测项","证据","得分"].forEach(v=>head.append(element("th","",v))); const thead=element("thead");thead.append(head);const tbody=element("tbody");signals.forEach(s=>{const tr=element("tr");tr.append(element("td","",s.group),element("td","",s.label),element("td","",s.value),element("td",s.points===s.weight?"full":"miss",s.points+" / "+s.weight));tbody.append(tr);});table.append(thead,tbody);signalSection.append(table);content.append(signalSection);

            addListSection("发现的问题",list(c.issues),"未发现明确的环境矛盾信号"); addListSection("修复建议",list(c.fixes),"当前没有修复建议");
            if(c.gains){const grow=section("提分清单");list(c.gains).forEach(item=>{const f=item.split("~");addRow(grow,f[0]+"（+"+txt(f[1],"0")+"）",f.slice(2).join("~"));});}
            rows=section("支付与账号地区（人工核对）","本工具不读取账号或付款资料，因此不会伪装成已自动检测。"); addRow(rows,"账号注册地区","请确认与长期出口国家一致"); addRow(rows,"账单国家","请确认与账号及出口一致"); addRow(rows,"支付卡发行国","请人工确认，不纳入自动评分");
            const note=element("p","footer","报告生成于 "+txt(report.generatedAt)+" · CheckClaude v"+txt(report.version)); content.append(note);
            fetch("/close?t="+TOKEN,{method:"POST",body:"",keepalive:true}).catch(()=>{});
          }

          async function pollReport(){
            for(let i=0;i<200;i++){
              try{const r=await fetch("/report?t="+TOKEN,{cache:"no-store"});if(r.status===200){renderReport(await r.json());return;}}catch(e){}
              await new Promise(resolve=>setTimeout(resolve,750));
            }
            status.replaceChildren(element("span","pill bad","超时"),element("span","","系统检测没有在预期时间内完成，请从菜单栏重新体检。"));
          }

          async function collect(){
            try{
              const ua=navigator.userAgent||"", lower=ua.toLowerCase(), ro=Intl.DateTimeFormat().resolvedOptions();
              set("ua_js",ua);set("browser_name",browserName(ua));set("os_name",osName(ua));set("device_type",/iPhone/i.test(ua)?"iPhone":/iPad/i.test(ua)?"iPad":/Android/i.test(ua)?"Android 设备":/Mac/i.test(ua)?"Mac":/Windows/i.test(ua)?"Windows PC":"未知设备");
              set("languages",(navigator.languages||[navigator.language]).filter(Boolean).join(","));set("language_variant",/zh-(tw|hk|mo)|zh-hant/i.test(o.languages)?"繁体中文":/zh-cn|zh-sg|zh-hans|(^|,)zh(,|$)/i.test(o.languages)?"简体中文":"非中文或未识别");
              set("tz",ro.timeZone);set("locale",ro.locale);set("calendar",ro.calendar);set("numbering_system",ro.numberingSystem);set("hour_cycle",ro.hourCycle);set("tzoffset",-new Date().getTimezoneOffset()/60);
              set("platform",navigator.platform);set("vendor",navigator.vendor);set("hardware_concurrency",navigator.hardwareConcurrency);set("device_memory",navigator.deviceMemory||"");set("max_touch_points",navigator.maxTouchPoints||0);
              set("screen",screen.width+"×"+screen.height+" / 可用 "+screen.availWidth+"×"+screen.availHeight+" / "+screen.colorDepth+"bit");set("pixel_ratio",window.devicePixelRatio||1);
              set("cookie_enabled",navigator.cookieEnabled?"可用":"禁用");set("dnt",navigator.doNotTrack||window.doNotTrack||"未设置");set("global_privacy_control",navigator.globalPrivacyControl===true?"启用":"未启用/不支持");set("plugins_count",navigator.plugins?navigator.plugins.length:0);set("mime_types_count",navigator.mimeTypes?navigator.mimeTypes.length:0);
              try{localStorage.setItem("__cc_probe","1");localStorage.removeItem("__cc_probe");set("local_storage","可用");}catch(e){set("local_storage","不可用");}
              const conn=navigator.connection||navigator.mozConnection||navigator.webkitConnection||{};set("connection_type",conn.effectiveType||conn.type||"浏览器不提供");set("connection_rtt",conn.rtt||"");set("connection_downlink",conn.downlink||"");set("connection_save_data",conn.saveData?"开启":"关闭/不支持");
              const flags=[];if(navigator.webdriver)flags.push("navigator.webdriver");if(/HeadlessChrome|PhantomJS/i.test(ua))flags.push("Headless");if(window.top!==window.self)flags.push("iframe");if(lower.includes("; wv)")||lower.includes(" webview")||(lower.includes("version/")&&lower.includes(" chrome/")))flags.push("WebView");if(/MicroMessenger|Weibo/i.test(ua)||ua.includes("QQ/"))flags.push("内嵌浏览器");set("runtime_flags",flags.join(", "));
              set("emoji_style",/iPhone|iPad|Mac OS/i.test(ua)?"Apple Emoji":/Android|HarmonyOS/i.test(ua)?"Android / 厂商 Emoji":/Windows/i.test(ua)?"Windows Emoji":"未知");
              set("feature_webgpu","gpu" in navigator?"支持":"不支持");set("feature_wasm",typeof WebAssembly!=="undefined"?"支持":"不支持");set("feature_service_worker","serviceWorker" in navigator?"支持":"不支持");set("feature_webcrypto",window.crypto&&crypto.subtle?"支持":"不支持");
              if(navigator.userAgentData){set("uad_mobile",navigator.userAgentData.mobile);set("uad_platform",navigator.userAgentData.platform);try{const h=await navigator.userAgentData.getHighEntropyValues(["platformVersion","architecture","fullVersionList"]);set("uad_platform_version",h.platformVersion);set("uad_arch",h.architecture);set("uad_brands",(h.fullVersionList||[]).map(x=>x.brand+" "+x.version).join("; "));}catch(e){}}
              try{const c=document.createElement("canvas");c.width=280;c.height=60;const x=c.getContext("2d");x.fillStyle="#f60";x.fillRect(8,8,80,28);x.fillStyle="#069";x.font="16px Arial";x.fillText("CheckClaude 环境检测 🧭",12,27);set("canvas",hash(c.toDataURL()));}catch(e){}
              try{const c=document.createElement("canvas"),gl=c.getContext("webgl")||c.getContext("experimental-webgl"),dbg=gl&&gl.getExtension("WEBGL_debug_renderer_info");if(gl){set("webgl_vendor",dbg?gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR));set("webgl_renderer",dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER));set("webgl",o.webgl_vendor+" · "+o.webgl_renderer);}}catch(e){}
              try{const probe=["PingFang SC","PingFang TC","Hiragino Sans GB","Microsoft YaHei","Microsoft JhengHei","SimSun","SimHei","MingLiU","Songti SC","STHeiti","Noto Sans CJK SC","Noto Sans CJK TC","Source Han Sans SC","MiSans","HarmonyOS Sans SC","OPPO Sans","vivo Sans"];const sp=document.createElement("span");sp.style.cssText="position:absolute;left:-9999px;font-size:72px";sp.textContent="mmmmmmmmmmlli测试";document.body.appendChild(sp);sp.style.fontFamily="monospace";const base=sp.offsetWidth;const found=probe.filter(f=>{sp.style.fontFamily="'"+f+"',monospace";return sp.offsetWidth!==base;});sp.remove();set("fonts",found.join(","));set("fonts_sc",found.filter(f=>/SC|YaHei|SimSun|SimHei|Songti|STHeiti|MiSans|HarmonyOS|OPPO|vivo|Hiragino/i.test(f)).join(","));set("fonts_tc",found.filter(f=>/TC|JhengHei|MingLiU|PingFang TC/i.test(f)).join(","));set("fonts_vendor",found.filter(f=>/MiSans|HarmonyOS|OPPO|vivo/i.test(f)).join(","));}catch(e){}
              const reachOne=async(key,url)=>{const started=performance.now(),ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),3500);try{await fetch(url,{mode:"no-cors",cache:"no-store",signal:ctl.signal});set("reach_"+key,"ok");set("reach_"+key+"_ms",Math.round(performance.now()-started));}catch(e){set("reach_"+key,e&&e.name==="AbortError"?"timeout":"error");set("reach_"+key+"_ms","");}finally{clearTimeout(timer);}};
              const reachPromise=Promise.all([reachOne("anthropic","https://www.anthropic.com/"),reachOne("api","https://api.anthropic.com/")]);
              set("rtc_host","");set("rtc_srflx","");set("rtc_candidate_count",0);set("rtc_public_count",0);set("rtc_supported",0);set("rtc_status","unsupported");
              if("RTCPeerConnection" in window){set("rtc_supported",1);set("rtc_status","collecting");const started=performance.now();try{const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.cloudflare.com:3478"},{urls:"stun:stun.l.google.com:19302"}]});pc.createDataChannel("p");const hosts=new Set(),srflx=new Set();let candidates=0,completed=false,finish;const gathered=new Promise(r=>{finish=r;});pc.onicecandidate=e=>{if(!e.candidate){completed=true;finish();return;}candidates++;const c=e.candidate.candidate,m=c.match(/([0-9]{1,3}(?:\\.[0-9]{1,3}){3})/);if(!m)return;if(c.includes("typ host"))hosts.add(m[1]);if(c.includes("typ srflx"))srflx.add(m[1]);};pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==="complete"){completed=true;finish();}};await pc.setLocalDescription(await pc.createOffer());await Promise.race([gathered,new Promise(r=>setTimeout(r,4500))]);set("rtc_host",[...hosts].join(","));set("rtc_srflx",[...srflx].join(","));set("rtc_candidate_count",candidates);set("rtc_public_count",srflx.size);set("rtc_elapsed_ms",Math.round(performance.now()-started));set("rtc_status",srflx.size>0?"ok":completed?"none":"timeout");pc.close();}catch(e){set("rtc_status","error");set("rtc_elapsed_ms",Math.round(performance.now()-started));set("rtc_err",String(e).slice(0,80));}}
              await reachPromise;
              const body=Object.keys(o).map(k=>k+"="+o[k]).join("\\n");
              const response=await fetch("/r?t="+TOKEN,{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},body,cache:"no-store"});if(!response.ok)throw new Error("HTTP "+response.status);
              status.replaceChildren(element("span","spinner"),element("span","","浏览器信号已完成，正在汇总系统、出口、DNS与评分结果…"));renderWaiting();await pollReport();
            }catch(e){status.replaceChildren(element("span","pill bad","采集失败"),element("span","",String(e)));}
          }
          collect();
        })();
        </script></body></html>
        """
    }
}

