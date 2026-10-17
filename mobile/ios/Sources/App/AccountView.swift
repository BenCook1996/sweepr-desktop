import StoreKit
import SwiftUI
import UIKit

typealias AccountSettingsView = AccountView

struct AccountView: View {
    @ObservedObject var vm: AppViewModel
    let onShowPaywall: () -> Void

    @AppStorage("sweepr_theme_mode") private var themeModeRaw: String = SweeprThemeMode.system.rawValue
    @State private var showSignInSheet = false
    @State private var showDeleteConfirm = false
    @State private var showCrashLogSheet = false
    @State private var otpEmail = ""
    @State private var otpCode = ""
    @State private var otpSent = false
    @State private var friendReferralInput = ""
    @State private var crashLogText = ""

    var body: some View {
        NavigationStack {
            List {
                // 1. Membership & Subscriptions
                Section(header: Text("Membership")) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(vm.hasPremium ? "SWEEPR Cleaner Pro Active" : "Free Plan")
                                .font(.headline)
                                .foregroundColor(vm.hasPremium ? .sweeprEmerald : .primary)
                            Text(vm.subscriptionInfoText)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        if !vm.hasPremium {
                            Button("Upgrade") {
                                onShowPaywall()
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.sweeprEmerald)
                            .accessibilityLabel("Upgrade to SWEEPR Cleaner Pro")
                        }
                    }
                    .padding(.vertical, 4)

                    Button("Restore Purchases") {
                        Task { await vm.restorePurchases() }
                    }
                    .accessibilityLabel("Restore Purchases")

                    Button("Manage Subscription") {
                        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
                            Task {
                                try? await AppStore.showManageSubscriptions(in: scene)
                            }
                        }
                    }
                    .accessibilityLabel("Manage Apple Subscription")
                }

                // 2. Cross-Platform SWEEPR Cleaner Account (Store-compliant Guidelines 3.1.2 & 5.1.1(v))
                Section(
                    header: Text("SWEEPR Cleaner Account"),
                    footer: Text("Link your email with a 6-digit OTP to sync your SWEEPR Cleaner Pro entitlement across Windows, macOS, Linux, iOS, and Android.")
                ) {
                    if vm.linkedAccount.isSignedIn {
                        HStack {
                            Text("Signed in as")
                            Spacer()
                            Text(vm.linkedAccount.email)
                                .foregroundColor(.secondary)
                        }
                        Button("Refresh Account Status") {
                            Task { await vm.refreshLinkedAccount() }
                        }
                        Button("Sign Out") {
                            vm.signOut()
                        }
                        Button(role: .destructive) {
                            showDeleteConfirm = true
                        } label: {
                            Text("Delete Account & Data")
                        }
                        .accessibilityLabel("Delete SWEEPR Cleaner Account and Data permanently")
                    } else {
                        Button {
                            otpEmail = ""
                            otpCode = ""
                            otpSent = false
                            showSignInSheet = true
                        } label: {
                            Label("Link SWEEPR Cleaner Account (6-Digit Email OTP)", systemImage: "envelope.badge.shield.half.filled")
                        }
                        .accessibilityLabel("Link SWEEPR Cleaner Account via 6-digit Email OTP")
                    }
                }

                // 3. Referral Code Card
                Section(
                    header: Text("Refer a Friend"),
                    footer: Text("Share your SWEEPR Cleaner referral code with friends or redeem a friend's invite code.")
                ) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Your Referral Code")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                Text(vm.linkedAccount.referralCode)
                                    .font(.system(.headline, design: .monospaced))
                                    .foregroundColor(.sweeprEmerald)
                            }
                            Spacer()
                            Button {
                                UIPasteboard.general.string = vm.linkedAccount.referralCode
                                vm.alertMessage = "Copied referral code \(vm.linkedAccount.referralCode) to clipboard."
                            } label: {
                                Label("Copy", systemImage: "doc.on.doc")
                                    .font(.caption)
                            }
                            .buttonStyle(.bordered)

                            if let shareURL = URL(string: "\(AppConfig.websiteURL)?ref=\(vm.linkedAccount.referralCode)") {
                                ShareLink(
                                    item: shareURL,
                                    message: Text("Clean up your phone & PC with SWEEPR Cleaner! Use my referral code \(vm.linkedAccount.referralCode)")
                                ) {
                                    Label("Share", systemImage: "square.and.arrow.up")
                                        .font(.caption)
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(.sweeprEmerald)
                            }
                        }

                        Divider()

                        if let redeemed = vm.linkedAccount.redeemedReferralCode, !redeemed.isEmpty {
                            HStack {
                                Image(systemName: "checkmark.seal.fill")
                                    .foregroundColor(.sweeprEmerald)
                                Text("Redeemed referral code: \(redeemed)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        } else {
                            HStack {
                                TextField("Enter friend's code", text: $friendReferralInput)
                                    .textInputAutocapitalization(.characters)
                                    .disableAutocorrection(true)
                                    .font(.subheadline)
                                Button("Redeem") {
                                    Task {
                                        await vm.redeemReferralCode(friendReferralInput)
                                        friendReferralInput = ""
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(friendReferralInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || vm.isWorking)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }

                // 4. Appearance & Feedback
                Section(header: Text("Appearance & Feedback")) {
                    Picker("Theme", selection: $themeModeRaw) {
                        ForEach(SweeprThemeMode.allCases) { mode in
                            Text(mode.label).tag(mode.rawValue)
                        }
                    }
                    .accessibilityLabel("App Appearance Theme")

                    Button {
                        vm.requestAppStoreReview()
                    } label: {
                        Label("Rate SWEEPR Cleaner on the App Store", systemImage: "star.bubble")
                    }
                    .accessibilityLabel("Rate SWEEPR Cleaner on the App Store")
                }

                // 5. Legal, Diagnostics & Support
                Section(header: Text("About, Diagnostics & Legal")) {
                    if let website = URL(string: AppConfig.websiteURL) {
                        Link("Official Website", destination: website)
                        Link("Privacy Policy", destination: website.appendingPathComponent("privacy"))
                        Link("Terms of Service", destination: website.appendingPathComponent("terms"))
                    }

                    if let emailURL = URL(string: "mailto:\(AppConfig.supportEmail)") {
                        Link("Contact Support", destination: emailURL)
                    }

                    Button {
                        crashLogText = CrashLogger.readLogs()
                        showCrashLogSheet = true
                    } label: {
                        Label("On-Device Crash & Diagnostic Logs", systemImage: "doc.text.magnifyingglass")
                    }

                    HStack {
                        Text("Version")
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Account")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    SweeprLogoView(size: 30)
                }
            }
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
                Text("This permanently deletes your SWEEPR Cleaner account, linked devices, and server records via DELETE /v1/account. Active Apple StoreKit subscriptions are managed in your Apple ID settings.")
            }
        }
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
