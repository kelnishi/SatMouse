import SafariServices
import os.log

/// Minimal Safari Web Extension handler.
/// Safari requires a compiled .appex with this class to load the web extension.
/// The actual extension logic lives in background.js (service worker).
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let profile: UUID?

        if #available(macOS 13.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        os_log(.default, "[SatMouse Extension] Request from profile: %{public}@",
               profile?.uuidString ?? "default")

        let response = NSExtensionItem()
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
