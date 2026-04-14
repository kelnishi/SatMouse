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
