import Cocoa
import SafariServices
import WebKit

let extensionBundleIdentifier = "com.kelnishi.SatMouse.Extension"

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: "controller")
        webView.setValue(false, forKey: "drawsBackground") // Transparent background
        webView.loadFileURL(
            Bundle.main.url(forResource: "Main", withExtension: "html", subdirectory: "Base.lproj")!,
            allowingReadAccessTo: Bundle.main.resourceURL!
        )
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Set version
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        webView.evaluateJavaScript("setVersion('\(version)')")

        // Token for the bridge's write endpoints (a UUID, safe in a JS string literal)
        if let token = (NSApp.delegate as? AppDelegate)?.controlToken {
            webView.evaluateJavaScript("setControlToken('\(token)')")
        }

        // Check extension state
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            DispatchQueue.main.async {
                let enabled = state?.isEnabled ?? false
                webView.evaluateJavaScript("updateExtensionState(\(enabled))")
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? String else { return }
        if body == "open-project" {
            NSWorkspace.shared.open(URL(string: "https://kelnishi.github.io/SatMouse")!)
        } else if body == "open-client" {
            NSWorkspace.shared.open(URL(string: "http://127.0.0.1:18945/client/")!)
        } else if body.hasPrefix("open-url:") {
            // Only the Rotatrix profile import; the web view can't open custom schemes itself
            let link = String(body.dropFirst("open-url:".count))
            if link.hasPrefix("rotatrix://import?"), let url = URL(string: link) {
                NSWorkspace.shared.open(url)
            }
        } else if body == "open-extension-settings" {
            SFSafariApplication.showPreferencesForExtension(
                withIdentifier: extensionBundleIdentifier
            ) { error in
                if let error = error {
                    NSLog("[SatMouse] Failed to open extension prefs: \(error)")
                }
            }
        }
    }
}
