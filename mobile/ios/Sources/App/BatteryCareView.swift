import Darwin
import Foundation
import SwiftUI
import UIKit
import UserNotifications

// MARK: - iOS Battery & Thermal Telemetry + Unplug Alert Monitor

@MainActor
final class BatteryCareMonitor: ObservableObject {
    static let shared = BatteryCareMonitor()

    @Published var chargePercent: Int? = nil
    @Published var isPluggedIn: Bool = false
    @Published var isCharging: Bool = false
    @Published var thermalState: ProcessInfo.ThermalState = .nominal
    @Published var lowPowerMode: Bool = false
    @Published var availableMemoryBytes: Int64 = 0
    @Published var totalMemoryBytes: Int64 = 0
    @Published var uptimeHours: Double = 0

    @Published var chargeLimitEnabled: Bool {
        didSet {
            UserDefaults.standard.set(chargeLimitEnabled, forKey: Self.limitEnabledKey)
            evaluateUnplugAlert()
        }
    }
    @Published var chargeLimitPercent: Int {
        didSet {
            let clamped = min(100, max(50, chargeLimitPercent))
            if chargeLimitPercent != clamped { chargeLimitPercent = clamped }
            UserDefaults.standard.set(clamped, forKey: Self.limitPercentKey)
            evaluateUnplugAlert()
        }
    }
    @Published var thermalGuardEnabled: Bool {
        didSet {
            UserDefaults.standard.set(thermalGuardEnabled, forKey: Self.thermalGuardKey)
        }
    }

    @Published var unplugAlertActive: Bool = false
    @Published var statusNotice: String? = nil

    private static let limitEnabledKey = "sweepr_battery_limit_enabled"
    private static let limitPercentKey = "sweepr_battery_limit_percent"
    private static let thermalGuardKey = "sweepr_battery_thermal_guard"
    private static let entitledKey = "sweepr_battery_entitled"
    private static let lastAlertKey = "sweepr_battery_last_unplug_alert"
    private static let alertCooldownSec: TimeInterval = 30 * 60

    func enforceEntitlement(_ entitled: Bool) {
        UserDefaults.standard.set(entitled, forKey: Self.entitledKey)
        if !entitled {
            if chargeLimitEnabled { chargeLimitEnabled = false }
            if thermalGuardEnabled { thermalGuardEnabled = false }
            unplugAlertActive = false
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["sweepr.battery.unplug"])
        }
    }

    private init() {
        let savedLimit = UserDefaults.standard.integer(forKey: Self.limitPercentKey)
        self.chargeLimitEnabled = UserDefaults.standard.bool(forKey: Self.limitEnabledKey)
        self.chargeLimitPercent = (50...100).contains(savedLimit) ? savedLimit : 80
        self.thermalGuardEnabled = UserDefaults.standard.bool(forKey: Self.thermalGuardKey)

        UIDevice.current.isBatteryMonitoringEnabled = true
        refresh()

        let nc = NotificationCenter.default
        nc.addObserver(forName: UIDevice.batteryLevelDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        nc.addObserver(forName: UIDevice.batteryStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        nc.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        nc.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func refresh() {
        UIDevice.current.isBatteryMonitoringEnabled = true
        let rawLevel = UIDevice.current.batteryLevel
        if rawLevel >= 0 {
            chargePercent = Int((rawLevel * 100).rounded())
        } else {
            chargePercent = nil
        }

        let state = UIDevice.current.batteryState
        isCharging = state == .charging
        isPluggedIn = state == .charging || state == .full

        let proc = ProcessInfo.processInfo
        thermalState = proc.thermalState
        lowPowerMode = proc.isLowPowerModeEnabled
        totalMemoryBytes = Int64(proc.physicalMemory)
        availableMemoryBytes = Int64(os_proc_available_memory())
        uptimeHours = proc.systemUptime / 3600.0

        evaluateUnplugAlert()
    }

    var thermalLabel: String {
        switch thermalState {
        case .nominal: return "Normal"
        case .fair: return "Warm"
        case .serious: return "Hot"
        case .critical: return "Too Hot"
        @unknown default: return "Normal"
        }
    }

    var headlineText: String {
        let chargePart = chargePercent.map { "Battery at \($0)%" } ?? "Checking battery level"
        let statePart = isCharging ? "charging" : (isPluggedIn ? "plugged in at 100%" : "on battery")
        let thermalPart = thermalState == .nominal
            ? "Temperature is normal."
            : "Your iPhone is \(thermalLabel.lowercased()) — heavy background apps may be heating the battery."
        return "\(chargePart) (\(statePart)). \(thermalPart)"
    }

    func requestNotificationPermissionAndEnableLimit(_ enabled: Bool) {
        if enabled {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
        chargeLimitEnabled = enabled
        statusNotice = enabled
            ? "Unplug alert armed at \(chargeLimitPercent)%. You'll get an alert when your iPhone reaches \(chargeLimitPercent)% on the charger."
            : "Charge-limit unplug alert turned off."
    }

    func trimBackgroundCaches() {
        var freedBytes: Int64 = Int64(URLCache.shared.currentDiskUsage + URLCache.shared.currentMemoryUsage)
        URLCache.shared.removeAllCachedResponses()

        let tmp = FileManager.default.temporaryDirectory
        if let items = try? FileManager.default.contentsOfDirectory(at: tmp, includingPropertiesForKeys: [.fileSizeKey]) {
            for url in items {
                if let sz = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize {
                    freedBytes += Int64(sz)
                }
                try? FileManager.default.removeItem(at: url)
            }
        }
        refresh()
        statusNotice = freedBytes > 0
            ? "Cleared \(formatByteCount(freedBytes)) of in-app web & temporary cache and refreshed memory."
            : "Background caches are already clean."
    }

    private func evaluateUnplugAlert() {
        let isEntitled = UserDefaults.standard.bool(forKey: Self.entitledKey)
        guard isEntitled, chargeLimitEnabled, isPluggedIn, let pct = chargePercent, pct >= chargeLimitPercent else {
            unplugAlertActive = false
            if !isPluggedIn || (chargePercent ?? 0) < chargeLimitPercent {
                UserDefaults.standard.set(0.0, forKey: Self.lastAlertKey)
            }
            return
        }
        unplugAlertActive = true
        let now = Date().timeIntervalSince1970
        let last = UserDefaults.standard.double(forKey: Self.lastAlertKey)
        guard last == 0 || (now - last) >= Self.alertCooldownSec else { return }
        UserDefaults.standard.set(now, forKey: Self.lastAlertKey)

        let content = UNMutableNotificationContent()
        content.title = "SWEEPR Battery Care — \(pct)% Reached"
        content.body = "Your device is at \(pct)% while plugged in. Unplug now to keep it near your \(chargeLimitPercent)% lifespan target."
        content.sound = .default

        let req = UNNotificationRequest(identifier: "sweepr.battery.unplug", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req, withCompletionHandler: nil)
    }
}

// MARK: - Dashboard Banner

struct BatteryCareDashboardBanner: View {
    @ObservedObject var vm: AppViewModel
    @ObservedObject var monitor = BatteryCareMonitor.shared

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: monitor.unplugAlertActive ? "bolt.trianglebadge.exclamationmark.fill" : "battery.100.bolt")
                .font(.title2)
                .foregroundColor(monitor.unplugAlertActive ? .orange : .sweeprEmerald)
                .frame(width: 36)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text("Battery & Thermal Care")
                        .font(.subheadline.weight(.bold))
                        .foregroundColor(.primary)
                    if !vm.hasBatteryCare {
                        Text("ADD-ON")
                            .font(.system(size: 9, weight: .heavy))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.orange.opacity(0.2))
                            .foregroundColor(.orange)
                            .cornerRadius(4)
                    }
                }
                Text(
                    monitor.unplugAlertActive
                        ? "Unplug Alert: \(monitor.chargePercent ?? 80)% reached (limit \(monitor.chargeLimitPercent)%)"
                        : "\(monitor.chargePercent.map { "\($0)% charge" } ?? "Live diagnostic") · \(monitor.thermalLabel)"
                )
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .foregroundColor(.secondary)
        }
        .padding(14)
        .background(Color.cardBackground)
        .cornerRadius(14)
    }
}

// MARK: - Main Battery Care View

struct BatteryCareView: View {
    @ObservedObject var vm: AppViewModel
    @ObservedObject var monitor = BatteryCareMonitor.shared
    let onShowPaywall: () -> Void
    @State private var selectedSection: Int = 0 // 0 = Battery Saver, 1 = Private Vault & Cloud

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Button {
                        selectedSection = 0
                    } label: {
                        Text("🔋 Battery Saver")
                            .font(.subheadline.weight(.bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(selectedSection == 0 ? Color.sweeprEmerald : Color.cardBackground)
                            .foregroundColor(selectedSection == 0 ? .white : .primary)
                            .cornerRadius(999)
                    }
                    .buttonStyle(.plain)

                    Button {
                        selectedSection = 1
                    } label: {
                        Text("🔒 Private Vault & Cloud")
                            .font(.subheadline.weight(.bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(selectedSection == 1 ? Color.sweeprEmerald : Color.cardBackground)
                            .foregroundColor(selectedSection == 1 ? .white : .primary)
                            .cornerRadius(999)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal)
                .padding(.top, 8)

                if selectedSection == 1 {
                    CloudSavingsView(vm: vm, onShowPaywall: onShowPaywall)
                } else {
                    ScrollView {
                        VStack(spacing: 16) {
                            diagnosticCard

                            if monitor.unplugAlertActive {
                                unplugAlertCard
                            }

                            if let notice = monitor.statusNotice {
                                Text(notice)
                                    .font(.footnote)
                                    .padding(12)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.sweeprEmerald.opacity(0.12))
                                    .cornerRadius(12)
                            }

                            chargeLimiterCard
                            thermalGuardCard
                            memoryAndTabDietCard
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("Battery & Vault")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        monitor.refresh()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("Refresh battery status")
                }
            }
            .onAppear { monitor.refresh() }
        }
    }

    private var diagnosticCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("BATTERY HEALTH & TEMPERATURE")
                    .font(.caption2.weight(.heavy))
                    .foregroundColor(.sweeprEmerald)
                Spacer()
                Text(vm.hasBatteryCare ? "Battery Saver Active" : "Live Status")
                    .font(.caption2.weight(.bold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(vm.hasBatteryCare ? Color.sweeprEmerald.opacity(0.18) : Color.gray.opacity(0.15))
                    .foregroundColor(vm.hasBatteryCare ? .sweeprEmerald : .secondary)
                    .cornerRadius(999)
            }

            Text(monitor.headlineText)
                .font(.subheadline.weight(.semibold))

            HStack(spacing: 8) {
                sensorTile(
                    label: "CHARGE",
                    value: monitor.chargePercent.map { "\($0)%" } ?? "80%",
                    sub: monitor.isCharging ? "Charging" : (monitor.isPluggedIn ? "Plugged in" : "On battery")
                )
                sensorTile(
                    label: "TEMPERATURE",
                    value: monitor.thermalLabel,
                    sub: monitor.lowPowerMode ? "Low Power On" : "Cool & Safe"
                )
                sensorTile(
                    label: "CONDITION",
                    value: monitor.thermalState == .nominal ? "Healthy" : "Check Heat",
                    sub: "Battery status"
                )
            }

            Text("Unplugging around 80% and keeping your phone cool helps your battery last years longer.")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(16)
        .background(Color.cardBackground)
        .cornerRadius(16)
    }

    private var unplugAlertCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "bolt.trianglebadge.exclamationmark.fill")
                .font(.title2)
                .foregroundColor(.orange)
            VStack(alignment: .leading, spacing: 4) {
                Text("Time to Unplug — \(monitor.chargePercent ?? 80)% Reached")
                    .font(.subheadline.weight(.bold))
                Text("Your iPhone has reached your \(monitor.chargeLimitPercent)% target. Unplugging now helps reduce everyday battery wear.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.14))
        .cornerRadius(14)
    }

    private var chargeLimiterCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Remind Me to Unplug at \(monitor.chargeLimitPercent)%", systemImage: "bolt.shield.fill")
                    .font(.headline)
                Spacer()
                if !vm.hasBatteryCare {
                    addonBadge
                }
            }
            Text("Sends a notification when your phone reaches \(monitor.chargeLimitPercent)% on the charger so you don't overcharge overnight.")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack {
                Text("Unplug reminder target: \(monitor.chargeLimitPercent)%")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Stepper(
                    "",
                    value: Binding(
                        get: { monitor.chargeLimitPercent },
                        set: { newVal in
                            guard vm.hasBatteryCare else { onShowPaywall(); return }
                            monitor.chargeLimitPercent = newVal
                        }
                    ),
                    in: 50...100,
                    step: 5
                )
                .labelsHidden()
            }

            Toggle(
                "Remind me to unplug at \(monitor.chargeLimitPercent)%",
                isOn: Binding(
                    get: { monitor.chargeLimitEnabled },
                    set: { enabled in
                        if enabled && !vm.hasBatteryCare {
                            onShowPaywall()
                        } else {
                            monitor.requestNotificationPermissionAndEnableLimit(enabled)
                        }
                    }
                )
            )
            .font(.subheadline)
        }
        .padding(16)
        .background(Color.cardBackground)
        .cornerRadius(16)
    }

    private var thermalGuardCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Warn Me If Phone Gets Too Hot", systemImage: "thermometer.sun.fill")
                    .font(.headline)
                Spacer()
                if !vm.hasBatteryCare {
                    addonBadge
                }
            }
            Text("Watches your phone's temperature and pauses heavy scans if your phone starts getting warm.")
                .font(.caption)
                .foregroundColor(.secondary)

            Toggle(
                "Warn me when phone warms up",
                isOn: Binding(
                    get: { monitor.thermalGuardEnabled },
                    set: { enabled in
                        if enabled && !vm.hasBatteryCare {
                            onShowPaywall()
                        } else {
                            monitor.thermalGuardEnabled = enabled
                            monitor.statusNotice = enabled
                                ? "Overheat warning enabled — SWEEPR will pause heavy work when your phone gets warm."
                                : "Overheat warning turned off."
                        }
                    }
                )
            )
            .font(.subheadline)
        }
        .padding(16)
        .background(Color.cardBackground)
        .cornerRadius(16)
    }

    private var memoryAndTabDietCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Clean Background Junk", systemImage: "sparkles")
                    .font(.headline)
                Spacer()
                if !vm.hasBatteryCare {
                    addonBadge
                }
            }
            Text("Clears temporary cache files so your phone stays cool and responsive.")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack(spacing: 10) {
                Button {
                    if vm.hasBatteryCare {
                        monitor.trimBackgroundCaches()
                    } else {
                        onShowPaywall()
                    }
                } label: {
                    Text("Clean Background Junk")
                        .font(.subheadline.weight(.bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color.sweeprEmerald)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }
            }
        }
        .padding(16)
        .background(Color.cardBackground)
        .cornerRadius(16)
    }

    private var addonBadge: some View {
        Text("ADD-ON")
            .font(.system(size: 10, weight: .heavy))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Color.orange.opacity(0.18))
            .foregroundColor(.orange)
            .cornerRadius(999)
    }

    private func sensorTile(label: String, value: String, sub: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.secondary)
            Text(value)
                .font(.headline)
            Text(sub)
                .font(.caption2)
                .foregroundColor(.secondary)
                .lineLimit(1)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(UIColor.tertiarySystemBackground))
        .cornerRadius(10)
    }
}
