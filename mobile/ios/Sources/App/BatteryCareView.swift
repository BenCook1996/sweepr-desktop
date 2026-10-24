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

// MARK: - Main Battery Care View (Candidate 5: SWEEPR Signature Hybrid)

struct BatteryCareView: View {
    @ObservedObject var vm: AppViewModel
    @ObservedObject var monitor = BatteryCareMonitor.shared
    let onShowPaywall: () -> Void
    @State private var selectedSection: Int = 0 // 0 = Battery Care, 1 = Private Vault

    var body: some View {
        NavigationStack {
            ZStack {
                Color.sweeprCanvas.ignoresSafeArea()

                VStack(spacing: 12) {
                    SweeprWordmarkHeaderView(vm: vm, onShowPaywall: onShowPaywall)
                        .padding(.horizontal, 16)
                        .padding(.top, 4)

                    // Candidate 5 Segmented Bar (Battery Care | Private Vault)
                    HStack(spacing: 4) {
                        segmentedTabButton(
                            index: 0,
                            icon: "bolt.shield.fill",
                            title: "Battery Care"
                        )
                        segmentedTabButton(
                            index: 1,
                            icon: "lock.shield.fill",
                            title: "Private Vault"
                        )
                    }
                    .padding(4)
                    .background(Color.sweeprPanel)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Color.sweeprLine, lineWidth: 1)
                    )
                    .padding(.horizontal, 16)

                    if selectedSection == 1 {
                        CloudSavingsView(vm: vm, onShowPaywall: onShowPaywall)
                    } else {
                        ScrollView(showsIndicators: false) {
                            VStack(spacing: 14) {
                                diagnosticCard

                                if monitor.unplugAlertActive {
                                    unplugAlertCard
                                }

                                if let notice = monitor.statusNotice {
                                    Text(notice)
                                        .font(.footnote.weight(.semibold))
                                        .foregroundColor(.sweeprEmerald)
                                        .padding(12)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(Color.sweeprEmerald.opacity(0.12))
                                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                                .stroke(Color.sweeprEmerald.opacity(0.32), lineWidth: 1)
                                        )
                                }

                                chargeLimiterCard
                                thermalGuardCard
                            }
                            .padding(.horizontal, 16)
                            .padding(.bottom, 20)
                        }
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .onAppear { monitor.refresh() }
        }
    }

    private func segmentedTabButton(index: Int, icon: String, title: String) -> some View {
        let isSelected = selectedSection == index
        return Button {
            withAnimation(.easeInOut(duration: 0.18)) {
                selectedSection = index
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .bold))
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(isSelected ? Color.sweeprEmerald : Color.clear)
            .foregroundColor(isSelected ? .white : .sweeprMutedText)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var diagnosticCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("REAL-TIME SENSOR TELEMETRY")
                    .font(.system(size: 10, weight: .heavy))
                    .tracking(0.8)
                    .foregroundColor(.sweeprEmerald)
                Spacer()
                Button {
                    monitor.refresh()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 10, weight: .bold))
                        Text(vm.hasBatteryCare ? "Battery Care Active" : "Live Status")
                            .font(.system(size: 10, weight: .bold))
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(vm.hasBatteryCare ? Color.sweeprEmerald.opacity(0.16) : Color.sweeprPanelAlt)
                    .foregroundColor(vm.hasBatteryCare ? .sweeprEmerald : .sweeprMutedText)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(Color.sweeprLine, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }

            // 3-Column Sensor Telemetry (Single-line non-wrapping headers: CHARGE | TEMP | HEALTH)
            HStack(spacing: 8) {
                sensorTile(
                    label: "CHARGE",
                    value: monitor.chargePercent.map { "\($0)%" } ?? "80%",
                    sub: monitor.isCharging ? "Charging" : (monitor.isPluggedIn ? "Plugged in" : "Unplugged"),
                    valueColor: .primary
                )
                sensorTile(
                    label: "TEMP",
                    value: monitor.thermalLabel,
                    sub: monitor.lowPowerMode ? "Low Power" : "Cool & safe",
                    valueColor: monitor.thermalState == .nominal ? .sweeprEmerald : .sweeprAmber
                )
                sensorTile(
                    label: "HEALTH",
                    value: monitor.thermalState == .nominal ? "Good" : "Warm",
                    sub: "Li-ion status",
                    valueColor: .sweeprCyan
                )
            }

            // 20%–80% Optimal Lifespan Zone Bar
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Optimal Lifespan Zone")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.sweeprMutedText)
                    Spacer()
                    Text("Target: \(monitor.chargeLimitPercent)%")
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundColor(.sweeprEmerald)
                }

                GeometryReader { geo in
                    let w = geo.size.width
                    HStack(spacing: 3) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.sweeprAmber.opacity(0.45))
                            .frame(width: w * 0.20)
                        RoundedRectangle(cornerRadius: 4)
                            .fill(
                                LinearGradient(
                                    colors: [.sweeprEmerald, .sweeprCyan],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(width: w * 0.60)
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.sweeprRose.opacity(0.45))
                            .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 8)
                .clipShape(Capsule())

                HStack {
                    Text("0% Low")
                    Spacer()
                    Text("20%–80% Best Longevity")
                    Spacer()
                    Text("100% Wear")
                }
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(.sweeprMutedText)
            }
            .padding(11)
            .background(Color.sweeprPanelAlt)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.sweeprLine, lineWidth: 1)
            )
        }
        .padding(16)
        .sweeprCard(cornerRadius: 18)
    }

    private var unplugAlertCard: some View {
        HStack(alignment: .top, spacing: 12) {
            SweeprIconBadge(systemName: "bolt.trianglebadge.exclamationmark.fill", tint: .sweeprAmber, size: 38, iconSize: 17, cornerRadius: 12)
            VStack(alignment: .leading, spacing: 4) {
                Text("Time to Unplug — \(monitor.chargePercent ?? 80)% Reached")
                    .font(.subheadline.weight(.bold))
                Text("Your iPhone has reached your \(monitor.chargeLimitPercent)% target. Unplugging now helps reduce everyday battery wear.")
                    .font(.caption)
                    .foregroundColor(.sweeprMutedText)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.sweeprAmber.opacity(0.14))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.sweeprAmber.opacity(0.4), lineWidth: 1)
        )
    }

    private var isUnlocked: Bool {
        vm.hasPremium || vm.hasBatteryCare
    }

    private var chargeLimiterCard: some View {
        HStack(spacing: 12) {
            SweeprIconBadge(systemName: "bolt.shield.fill", tint: .sweeprEmerald, size: 36, iconSize: 16, cornerRadius: 11)
            Toggle(
                "80% Charge Guard",
                isOn: Binding(
                    get: { monitor.chargeLimitEnabled },
                    set: { enabled in
                        if enabled && !isUnlocked {
                            onShowPaywall()
                        } else {
                            monitor.chargeLimitPercent = 80
                            monitor.requestNotificationPermissionAndEnableLimit(enabled)
                        }
                    }
                )
            )
            .font(.system(size: 14, weight: .bold))
            .tint(.sweeprEmerald)
        }
        .padding(16)
        .sweeprCard(cornerRadius: 18)
    }

    private var thermalGuardCard: some View {
        HStack(spacing: 12) {
            SweeprIconBadge(systemName: "thermometer.sun.fill", tint: .sweeprAmber, size: 36, iconSize: 16, cornerRadius: 11)
            Toggle(
                "Overheat Protection",
                isOn: Binding(
                    get: { monitor.thermalGuardEnabled },
                    set: { enabled in
                        if enabled && !isUnlocked {
                            onShowPaywall()
                        } else {
                            monitor.thermalGuardEnabled = enabled
                            monitor.statusNotice = enabled
                                ? "Overheat protection on."
                                : "Overheat protection off."
                        }
                    }
                )
            )
            .font(.system(size: 14, weight: .bold))
            .tint(.sweeprEmerald)
        }
        .padding(16)
        .sweeprCard(cornerRadius: 18)
    }

    private var addonBadge: some View {
        Button {
            onShowPaywall()
        } label: {
            Text("+£9.99/YR")
                .font(.system(size: 9, weight: .heavy))
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.sweeprAmber.opacity(0.16))
                .foregroundColor(.sweeprAmber)
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(Color.sweeprAmber.opacity(0.38), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func sensorTile(label: String, value: String, sub: String, valueColor: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 9, weight: .heavy))
                .tracking(0.5)
                .foregroundColor(.sweeprMutedText)
                .lineLimit(1)
            Text(value)
                .font(.system(size: 17, weight: .heavy, design: .rounded))
                .foregroundColor(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(sub)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.sweeprMutedText)
                .lineLimit(1)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.sweeprPanelAlt)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.sweeprLine, lineWidth: 1)
        )
    }
}
