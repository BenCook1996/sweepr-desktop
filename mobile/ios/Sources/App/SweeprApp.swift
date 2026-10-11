import SwiftUI
import RevenueCat

@main
struct SweeprApp: App {
    init() {
        Purchases.logLevel = .debug
        Purchases.configure(withAPIKey: "appl_YOUR_REVENUECAT_API_KEY")
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
