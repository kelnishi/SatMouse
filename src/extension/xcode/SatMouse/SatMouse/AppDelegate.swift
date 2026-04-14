import Cocoa
import SafariServices

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem?
    var serverProcess: Process?
    func applicationDidFinishLaunching(_ notification: Notification) {
        let execPath = Bundle.main.executablePath ?? ""
        if execPath.contains("/AppTranslocation/") {
            let alert = NSAlert(); alert.messageText = "Move SatMouse to Applications"
            alert.informativeText = "Please drag SatMouse.app into the Applications folder, then relaunch."
            alert.alertStyle = .critical; alert.addButton(withTitle: "Quit"); alert.runModal()
            let home = NSHomeDirectory()
            try? FileManager.default.createDirectory(atPath: (home as NSString).appendingPathComponent("Applications"), withIntermediateDirectories: true)
            NSWorkspace.shared.open(URL(fileURLWithPath: (home as NSString).appendingPathComponent("Applications")))
            NSWorkspace.shared.open(URL(fileURLWithPath: (home as NSString).appendingPathComponent("Downloads")))
            NSApp.terminate(nil); return
        }
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        NSApp.setActivationPolicy(.accessory)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "🛰"
        let menu = NSMenu()
        menu.addItem(withTitle: "About SatMouse", action: #selector(openAbout), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Open Web Client", action: #selector(openClient), keyEquivalent: "")
        menu.addItem(withTitle: "Refresh Devices", action: #selector(refreshDevices), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(quitApp), keyEquivalent: "q")
        statusItem?.menu = menu
        startServer()

        // Register for satmouse:// URL scheme events
        NSAppleEventManager.shared().setEventHandler(
            self, andSelector: #selector(handleURL(_:withReply:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    @objc func handleURL(_ event: NSAppleEventDescriptor, withReply reply: NSAppleEventDescriptor) {
        guard let urlString = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
              let url = URL(string: urlString) else { return }
        NSLog("[SatMouse] URL scheme: \(urlString)")

        switch url.host {
        case "enable-extension":
            openExtensionPreferences()
        case "launch":
            break // App is already running
        default:
            break
        }
    }

    func openExtensionPreferences() {
        SFSafariApplication.showPreferencesForExtension(
            withIdentifier: "com.kelnishi.SatMouse.Extension"
        ) { error in
            if let error = error {
                NSLog("[SatMouse] Failed to open extension prefs: \(error)")
            }
        }
    }
    func startServer() {
        guard let res = Bundle.main.resourcePath else { return }
        let node = (res as NSString).appendingPathComponent("bin/node")
        let script = (res as NSString).appendingPathComponent("main.cjs")
        guard FileManager.default.fileExists(atPath: node), FileManager.default.fileExists(atPath: script) else { NSLog("[SatMouse] Node not found"); return }
        let p = Process(); p.executableURL = URL(fileURLWithPath: node); p.arguments = [script]
        p.environment = ProcessInfo.processInfo.environment.merging(["SATMOUSE_CHILD":"1"], uniquingKeysWith:{_,n in n})
        p.currentDirectoryURL = URL(fileURLWithPath: res)
        p.standardOutput = FileHandle.standardOutput; p.standardError = FileHandle.standardError
        p.terminationHandler = { [weak self] proc in NSLog("[SatMouse] Server exited (\(proc.terminationStatus))"); DispatchQueue.main.async { self?.serverProcess = nil; NSApp.terminate(nil) } }
        do { try p.run(); serverProcess = p; NSLog("[SatMouse] Server PID \(p.processIdentifier)") } catch { NSLog("[SatMouse] \(error)") }
    }
    @objc func openAbout() {
        // Show the main window (with version, extension status, connected clients)
        NSApp.setActivationPolicy(.regular)
        if let window = NSApp.windows.first {
            window.makeKeyAndOrderFront(nil)
        }
        NSApp.activate(ignoringOtherApps: true)
        // Go back to accessory after a moment (hides dock icon once window is shown)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            NSApp.setActivationPolicy(.accessory)
        }
    }
    @objc func openClient() { NSWorkspace.shared.open(URL(string:"http://127.0.0.1:18945/client/")!) }
    @objc func refreshDevices() { if let p = serverProcess?.processIdentifier { kill(p, SIGUSR1) } }
    @objc func quitApp() { serverProcess?.terminate(); NSApp.terminate(nil) }
    func applicationWillTerminate(_ n: Notification) { serverProcess?.terminate() }
}
