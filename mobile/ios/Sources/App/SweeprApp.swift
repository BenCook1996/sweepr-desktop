import RevenueCat
import SwiftUI

enum SweeprThemeMode: String, CaseIterable, Identifiable {
    case dark = "dark"
    case light = "light"
    case system = "system"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .dark: return "Obsidian Dark"
        case .light: return "Mint Light"
        case .system: return "Auto"
        }
    }

    var shortLabel: String {
        switch self {
        case .dark: return "Obsidian"
        case .light: return "Mint"
        case .system: return "Auto"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

@main
struct SweeprApp: App {
    @AppStorage("sweepr_theme_mode") private var themeModeRaw: String = SweeprThemeMode.dark.rawValue

    init() {
        // Install on-device crash & uncaught exception logger
        CrashLogger.install()

        #if DEBUG
        // Verbose RevenueCat logs only in debug builds (they can include purchase details).
        Purchases.logLevel = .debug
        #endif

        // The public SDK key ("appl_...") is read from Info.plist key REVENUECAT_API_KEY
        // (set it via an xcconfig / build setting, e.g. REVENUECAT_API_KEY = $(REVENUECAT_API_KEY)),
        // so it isn't hardcoded in source.
        guard let apiKey = Bundle.main.object(forInfoDictionaryKey: "REVENUECAT_API_KEY") as? String,
              !apiKey.isEmpty, !apiKey.hasPrefix("$(") else {
            #if DEBUG
            NSLog("Sweepr [DEBUG]: REVENUECAT_API_KEY is missing from Info.plist – using offline/fallback store state until configured.")
            #else
            NSLog("Sweepr: REVENUECAT_API_KEY missing from Info.plist – purchases are disabled.")
            #endif
            return
        }
        #if DEBUG
        Purchases.configure(withAPIKey: apiKey)
        #else
        guard apiKey.hasPrefix("appl_") else {
            NSLog("Sweepr: Release build requires a production App Store RevenueCat API key (appl_...) – purchases are disabled.")
            return
        }
        Purchases.configure(withAPIKey: apiKey)
        #endif
        Purchases.shared.attribution.setAttributes(["project_id": AppConfig.projectId])
    }

    private var activeTheme: SweeprThemeMode {
        SweeprThemeMode(rawValue: themeModeRaw) ?? .system
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(activeTheme.colorScheme)
        }
    }
}
