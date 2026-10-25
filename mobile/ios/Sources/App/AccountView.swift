import StoreKit
import SwiftUI
import UIKit
import UserNotifications

typealias AccountSettingsView = AccountView

struct AccountView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void

    @AppStorage("sweepr_theme_mode") private var themeModeRaw: String = SweeprThemeMode.dark.rawValue
    @AppStorage("sweepr_cleanup_reminder") private var reminderFrequency: String = "Weekly"
    @AppStorage("sweepr_app_language") private var appLanguage: String = "English"
    @SceneStorage("sweepr_otp_sheet") private var showSignInSheet = false
    @State private var showDeleteConfirm = false
    @State private var showCrashLogSheet = false
    @SceneStorage("sweepr_otp_email") private var otpEmail = ""
    @State private var otpCode = ""
    @SceneStorage("sweepr_otp_sent") private var otpSent = false
    @State private var qrPairInput = ""
    @State private var qrPairStatus = ""
    @State private var friendReferralInput = ""
    @State private var crashLogText = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Color.sweeprCanvas.ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        SweeprWordmarkHeaderView(vm: vm, onShowPaywall: onShowPaywall)
                            .padding(.top, 4)

                        // 1. Customer 360 SWEEPR Pro Hero Card
                        customer360HeroCard

                        // 2. Inline Appearance & Theme Selector Chips
                        appearanceThemeSection

                        // 2b. Cleanup Reminders & App Language (Two-Way Parity with Android)
                        preferencesAndLanguageSection

                        // 3. Cross-Platform Account & Sync
                        crossPlatformAccountCard

                        // 4. Refer a Friend Card
                        referralCard

                        // 5. Support, Legal & Diagnostics Bento Card
                        supportAndLegalSection
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showSignInSheet) {
                otpSignInSheet
            }
            .sheet(isPresented: $showCrashLogSheet) {
                crashDiagnosticsSheet
            }
            .confirmationDialog(
                "Delete Account & Data?",
                isPresented: $showDeleteConfirm,
                titleVisibility: .visible
            ) {
                Button("Delete Permanently", role: .destructive) {
                    Task { await vm.deleteAccount() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This permanently deletes your SWEEPR Cleaner account and linked devices. Active App Store subscriptions are managed in your Apple ID settings.")
            }
        }
    }

    // MARK: - 1. Customer 360 SWEEPR Pro Hero Card

    private var customer360HeroCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                SweeprIconBadge(
                    systemName: vm.hasPremium ? "checkmark.seal.fill" : "sparkles",
                    tint: .sweeprEmerald,
                    size: 44,
                    iconSize: 20,
                    cornerRadius: 14
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(vm.hasPremium ? "SWEEPR Cleaner Pro Active" : "SWEEPR Cleaner — Free Plan")
                        .font(.system(size: 15.5, weight: .heavy))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    Text(
                        vm.linkedAccount.isSignedIn
                            ? "Signed in as \(vm.linkedAccount.email)"
                            : vm.subscriptionInfoText
                    )
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.sweeprMutedText)
                    .lineLimit(1)
                }
                Spacer()
            }

            Text("One account unlocks SWEEPR Pro across iPhone, Android, Windows & Mac.")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.sweeprMutedText)

            HStack(spacing: 8) {
                if !vm.hasPremium {
                    Button {
                        onShowPaywall()
                    } label: {
                        Text("Upgrade to Pro")
                            .font(.system(size: 13, weight: .heavy))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                            .background(
                                LinearGradient(
                                    colors: [.sweeprDarkEmerald, .sweeprEmerald],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .foregroundColor(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Upgrade to SWEEPR Cleaner Pro")
                }

                if !vm.linkedAccount.isSignedIn {
                    Button {
                        otpEmail = ""
                        otpCode = ""
                        otpSent = false
                        showSignInSheet = true
                    } label: {
                        Text("Sign In")
                            .font(.system(size: 13, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                            .background(Color.sweeprPanelAlt)
                            .foregroundColor(.primary)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(Color.sweeprLine, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }

                Button {
                    Task { await vm.restorePurchases() }
                } label: {
                    Text("Restore")
                        .font(.system(size: 13, weight: .bold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .background(Color.sweeprPanelAlt)
                        .foregroundColor(.sweeprEmerald)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(Color.sweeprLine, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Restore Purchases")
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color.sweeprPanel)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.sweeprEmerald.opacity(0.38), lineWidth: 1)
        )
    }

    // MARK: - 2. Inline Appearance & Theme Selector Chips

    private var appearanceThemeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("APPEARANCE & THEME")
                .font(.system(size: 11, weight: .heavy))
                .tracking(0.8)
                .foregroundColor(.sweeprMutedText)

            HStack(spacing: 8) {
                themeChip(mode: .dark, icon: "moon.stars.fill")
                themeChip(mode: .light, icon: "sun.max.fill")
                themeChip(mode: .system, icon: "circle.lefthalf.filled")
            }
        }
    }

    private func themeChip(mode: SweeprThemeMode, icon: String) -> some View {
        let isSelected = themeModeRaw == mode.rawValue
        return Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                themeModeRaw = mode.rawValue
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .bold))
                Text(mode.label)
                    .font(.system(size: 11, weight: .heavy))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .padding(.horizontal, 6)
            .background(isSelected ? Color.sweeprEmerald : Color.sweeprPanel)
            .foregroundColor(isSelected ? .white : .sweeprMutedText)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(isSelected ? Color.sweeprEmerald : Color.sweeprLine, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Set theme to \(mode.label)")
    }

    // MARK: - 2b. Cleanup Reminders & App Language (Android Parity)

    private var preferencesAndLanguageSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("CLEANUP REMINDERS & LANGUAGE")
                .font(.system(size: 11, weight: .heavy))
                .tracking(0.8)
                .foregroundColor(.sweeprMutedText)

            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    SweeprIconBadge(systemName: "bell.badge.fill", tint: .sweeprEmerald, size: 34, iconSize: 15, cornerRadius: 10)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Cleanup Reminders")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.primary)
                        Text("Gentle nudge when new duplicates pile up")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.sweeprMutedText)
                    }
                    Spacer()
                    Picker("Cleanup Reminders", selection: $reminderFrequency) {
                        Text("Off").tag("Off")
                        Text("Weekly").tag("Weekly")
                        Text("Monthly").tag("Monthly")
                    }
                    .pickerStyle(.menu)
                    .tint(.sweeprEmerald)
                    .onChange(of: reminderFrequency) { newValue in
                        scheduleCleanupReminder(frequency: newValue)
                    }
                }
                .padding(14)

                Divider().background(Color.sweeprLine)

                HStack(spacing: 12) {
                    SweeprIconBadge(systemName: "globe", tint: .sweeprCyan, size: 34, iconSize: 15, cornerRadius: 10)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("App Language")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.primary)
                        Text("Display language across SWEEPR")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.sweeprMutedText)
                    }
                    Spacer()
                    Picker("App Language", selection: $appLanguage) {
                        Text("English").tag("English")
                        Text("Deutsch").tag("Deutsch")
                        Text("Français").tag("Français")
                        Text("Español").tag("Español")
                        Text("Italiano").tag("Italiano")
                        Text("Nederlands").tag("Nederlands")
                        Text("Português").tag("Português")
                    }
                    .pickerStyle(.menu)
                    .tint(.sweeprEmerald)
                }
                .padding(14)
            }
            .sweeprCard(cornerRadius: 18)
        }
    }

    private func scheduleCleanupReminder(frequency: String) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ["sweepr_cleanup_reminder"])
        guard frequency != "Off" else { return }
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = "Time for a quick SWEEPR clean!"
            content.body = "Scan your library for new duplicate photos, screenshots, and large videos."
            content.sound = .default
            let seconds: TimeInterval = (frequency == "Monthly") ? (30 * 24 * 3600) : (7 * 24 * 3600)
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: true)
            let req = UNNotificationRequest(identifier: "sweepr_cleanup_reminder", content: content, trigger: trigger)
            center.add(req)
        }
    }

    // MARK: - 3. Cross-Platform Account Card

    private var crossPlatformAccountCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("CROSS-PLATFORM ACCOUNT")
                .font(.system(size: 11, weight: .heavy))
                .tracking(0.8)
                .foregroundColor(.sweeprMutedText)

            VStack(spacing: 0) {
                if vm.linkedAccount.isSignedIn {
                    HStack {
                        SweeprIconBadge(systemName: "envelope.badge.shield.half.filled", tint: .sweeprEmerald, size: 34, iconSize: 14, cornerRadius: 10)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Linked Email")
                                .font(.system(size: 13, weight: .bold))
                            Text(vm.linkedAccount.email)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(.sweeprMutedText)
                        }
                        Spacer()
                        Button("Sync") {
                            Task { await vm.refreshLinkedAccount() }
                        }
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundColor(.sweeprEmerald)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color.sweeprEmerald.opacity(0.14))
                        .clipShape(Capsule())
                    }
                    .padding(14)

                    Divider().background(Color.sweeprLine)

                    HStack(spacing: 12) {
                        Button("Sign Out") {
                            vm.signOut()
                        }
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.sweeprMutedText)

                        Spacer()

                        Button(role: .destructive) {
                            showDeleteConfirm = true
                        } label: {
                            Text("Delete Account & Data")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(.sweeprRose)
                        }
                    }
                    .padding(14)
                } else {
                    Button {
                        otpEmail = ""
                        otpCode = ""
                        otpSent = false
                        showSignInSheet = true
                    } label: {
                        HStack(spacing: 12) {
                            SweeprIconBadge(systemName: "envelope.badge.shield.half.filled", tint: .sweeprIndigo, size: 36, iconSize: 15, cornerRadius: 10)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Already have SWEEPR Pro? Sign in")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(.primary)
                                Text("Link your email with a 6-digit verification code")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundColor(.sweeprMutedText)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.bold))
                                .foregroundColor(.sweeprMutedText)
                        }
                        .padding(14)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }

                Divider().background(Color.sweeprLine)

                Button {
                    if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
                        Task {
                            try? await AppStore.showManageSubscriptions(in: scene)
                        }
                    }
                } label: {
                    HStack(spacing: 12) {
                        SweeprIconBadge(systemName: "creditcard.fill", tint: .sweeprCyan, size: 36, iconSize: 15, cornerRadius: 10)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Manage Apple Subscription")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(.primary)
                            Text("View billing or cancel anytime in App Store")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(.sweeprMutedText)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.bold))
                            .foregroundColor(.sweeprMutedText)
                    }
                    .padding(14)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .sweeprCard(cornerRadius: 18)
        }
    }

    // MARK: - 4. Refer a Friend Bento Card

    private var referralCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("REFER A FRIEND")
                .font(.system(size: 11, weight: .heavy))
                .tracking(0.8)
                .foregroundColor(.sweeprMutedText)

            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Your Invite Code")
                            .font(.caption)
                            .foregroundColor(.sweeprMutedText)
                        Text(vm.linkedAccount.referralCode)
                            .font(.system(.headline, design: .monospaced).weight(.heavy))
                            .foregroundColor(.sweeprEmerald)
                    }
                    Spacer()
                    Button {
                        UIPasteboard.general.string = vm.linkedAccount.referralCode
                        vm.alertMessage = "Copied referral code \(vm.linkedAccount.referralCode) to clipboard."
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                            .font(.system(size: 11, weight: .bold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.sweeprPanelAlt)
                            .foregroundColor(.primary)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(Color.sweeprLine, lineWidth: 1))
                    }
                    .buttonStyle(.plain)

                    if let shareURL = URL(string: "\(AppConfig.websiteURL)?ref=\(vm.linkedAccount.referralCode)") {
                        ShareLink(
                            item: shareURL,
                            message: Text("Clean up your phone & PC with SWEEPR Cleaner! Use my referral code \(vm.linkedAccount.referralCode)")
                        ) {
                            Label("Share", systemImage: "square.and.arrow.up")
                                .font(.system(size: 11, weight: .bold))
                                .padding(.horizontal, 11)
                                .padding(.vertical, 6)
                                .background(Color.sweeprEmerald)
                                .foregroundColor(.white)
                                .clipShape(Capsule())
                        }
                    }
                }

                Divider().background(Color.sweeprLine)

                if let redeemed = vm.linkedAccount.redeemedReferralCode, !redeemed.isEmpty {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundColor(.sweeprEmerald)
                        Text("Redeemed referral code: \(redeemed)")
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.sweeprMutedText)
                    }
                } else {
                    HStack(spacing: 8) {
                        TextField("Enter friend's invite code", text: $friendReferralInput)
                            .textInputAutocapitalization(.characters)
                            .disableAutocorrection(true)
                            .font(.subheadline)
                            .padding(9)
                            .background(Color.sweeprPanelAlt)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Color.sweeprLine, lineWidth: 1))

                        Button("Redeem") {
                            Task {
                                await vm.redeemReferralCode(friendReferralInput)
                                friendReferralInput = ""
                            }
                        }
                        .font(.system(size: 12, weight: .heavy))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(Color.sweeprEmerald)
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .disabled(friendReferralInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || vm.isWorking)
                    }
                }
            }
            .padding(14)
            .sweeprCard(cornerRadius: 18)
        }
    }

    // MARK: - 5. Support, Legal & Diagnostics Bento Card

    private var supportAndLegalSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("SUPPORT & LEGAL")
                .font(.system(size: 11, weight: .heavy))
                .tracking(0.8)
                .foregroundColor(.sweeprMutedText)

            VStack(spacing: 0) {
                Button {
                    vm.requestAppStoreReview()
                } label: {
                    settingsRow(icon: "star.bubble.fill", tint: .sweeprAmber, title: "Rate SWEEPR Cleaner", value: "App Store")
                }
                .buttonStyle(.plain)

                Divider().background(Color.sweeprLine)

                if let website = URL(string: AppConfig.websiteURL) {
                    Link(destination: website) {
                        settingsRow(icon: "globe", tint: .sweeprEmerald, title: "Official Website", value: "sweeprcleaner.com")
                    }
                    Divider().background(Color.sweeprLine)
                    Link(destination: website.appendingPathComponent("privacy")) {
                        settingsRow(icon: "hand.raised.fill", tint: .sweeprCyan, title: "Privacy Policy", value: "View")
                    }
                    Divider().background(Color.sweeprLine)
                    Link(destination: website.appendingPathComponent("terms")) {
                        settingsRow(icon: "doc.text.fill", tint: .sweeprIndigo, title: "Terms of Service", value: "View")
                    }
                    Divider().background(Color.sweeprLine)
                }

                if let emailURL = URL(string: "mailto:\(AppConfig.supportEmail)") {
                    Link(destination: emailURL) {
                        settingsRow(icon: "envelope.fill", tint: .sweeprEmerald, title: "Contact Support", value: "Email")
                    }
                    Divider().background(Color.sweeprLine)
                }

                Button {
                    crashLogText = CrashLogger.readLogs()
                    showCrashLogSheet = true
                } label: {
                    settingsRow(icon: "waveform.path.ecg", tint: .sweeprCyan, title: "Diagnostic Logs", value: "Inspect")
                }
                .buttonStyle(.plain)

                Divider().background(Color.sweeprLine)

                HStack {
                    Text("Version")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.sweeprMutedText)
                    Spacer()
                    Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.sweeprMutedText)
                }
                .padding(14)
            }
            .sweeprCard(cornerRadius: 18)
        }
    }

    private func settingsRow(icon: String, tint: Color, title: String, value: String) -> some View {
        HStack(spacing: 12) {
            SweeprIconBadge(systemName: icon, tint: tint, size: 32, iconSize: 14, cornerRadius: 9)
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(.primary)
                .lineLimit(1)
            Spacer()
            Text(value)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.sweeprMutedText)
                .lineLimit(1)
            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.sweeprMutedText)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    private var otpSignInSheet: some View {
        NavigationStack {
            Form {
                Section(
                    header: Text("6-Digit Email OTP Verification"),
                    footer: Text("We'll send a one-time 6-digit verification code to link this device with your SWEEPR Cleaner account.")
                ) {
                    if !otpSent {
                        TextField("Email Address", text: $otpEmail)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .disableAutocorrection(true)

                        Button("Send 6-Digit Code") {
                            Task {
                                let ok = await vm.sendOtp(email: otpEmail)
                                if ok { otpSent = true }
                            }
                        }
                        .disabled(otpEmail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || vm.isWorking)
                    } else {
                        Text("Enter the 6-digit code sent to \(otpEmail)")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("6-Digit Code", text: $otpCode)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)

                        Button("Verify & Link Account") {
                            Task {
                                let ok = await vm.verifyOtp(email: otpEmail, code: otpCode)
                                if ok { showSignInSheet = false }
                            }
                        }
                        .disabled(otpCode.trimmingCharacters(in: .whitespacesAndNewlines).count != 6 || vm.isWorking)

                        Button("Use a Different Email") {
                            otpSent = false
                        }
                    }
                }

                Section(
                    header: Text("Instant QR Code Device Link (Up to 3 Devices)"),
                    footer: Text("Paste a Portal QR token (ptk_...) to unlock this iPhone, or a Desktop QR challenge (chk_...) to unlock your PC.")
                ) {
                    TextField("ptk_... or chk_... or /pair URL", text: $qrPairInput)
                        .textInputAutocapitalization(.never)
                        .disableAutocorrection(true)

                    Button("Link Device via QR Token / Challenge") {
                        Task {
                            let val = qrPairInput.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !val.isEmpty else { return }
                            do {
                                if val.contains("chk_") {
                                    try await AccountService.approveDesktopQrChallenge(val, current: vm.linkedAccount)
                                    qrPairStatus = "✓ Desktop PC unlocked!"
                                } else {
                                    let linked = try await AccountService.redeemQrPairToken(val)
                                    vm.linkedAccount = linked
                                    qrPairStatus = "✓ iPhone linked to SWEEPR Cleaner Pro!"
                                    showSignInSheet = false
                                }
                            } catch {
                                qrPairStatus = error.localizedDescription
                            }
                        }
                    }
                    .disabled(qrPairInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    if !qrPairStatus.isEmpty {
                        Text(qrPairStatus)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Link SWEEPR Cleaner Account")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { showSignInSheet = false }
                }
            }
        }
    }

    private var crashDiagnosticsSheet: some View {
        NavigationStack {
            ScrollView {
                Text(crashLogText.isEmpty ? "No uncaught exceptions or diagnostic errors recorded on this device." : crashLogText)
                    .font(.system(.caption, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .navigationTitle("Diagnostic Logs")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Clear") {
                        CrashLogger.clearLogs()
                        crashLogText = ""
                    }
                    .disabled(crashLogText.isEmpty)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { showCrashLogSheet = false }
                }
            }
        }
    }
}
