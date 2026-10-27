package com.sweepr.app

import android.app.Application
import android.content.IntentSender
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.PeriodType
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesError
import com.revenuecat.purchases.awaitCustomerInfo
import com.revenuecat.purchases.interfaces.LogInCallback
import com.revenuecat.purchases.interfaces.UpdatedCustomerInfoListener
import com.revenuecat.purchases.restorePurchasesWith
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A trash or restore request waiting for the user to confirm it in the Android 11+ system dialog. */
data class PendingTrash(
    val items: List<MediaItem>,
    val intentSender: IntentSender,
    val isRestore: Boolean = false,
)

/** What the My Account screen shows about the in-app subscription. */
data class SubscriptionInfo(
    val active: Boolean = false,
    val batteryCareActive: Boolean = false,
    val productId: String? = null,
    val expiresAt: Long? = null,
    val willRenew: Boolean = false,
    val isTrial: Boolean = false,
    val managementUrl: String? = null,
    val appUserId: String = "",
)

const val PREMIUM_ENTITLEMENT = "premium"

/**
 * Real result of the most recent media cleanup, shown on the Cleaning Complete screen.
 * Storage fractions are StatFs readings taken just before and after the clean.
 */
data class CleanupSummary(
    val fileCount: Int,
    val bytes: Long,
    val movedToTrash: Boolean,
    val storageBefore: Float?,
    val storageAfter: Float?,
)

data class DashboardState(
    val isScanning: Boolean = false,
    val hasScanned: Boolean = false,
    val scanStatus: String = "",
    val media: MediaScanResult = MediaScanResult(),
    val contactGroups: List<ContactGroup> = emptyList(),
    val incompleteContacts: List<IncompleteContact> = emptyList(),
    val oldCalendarEvents: List<OldCalendarEvent> = emptyList(),
    val selectedMedia: Set<Uri> = emptySet(),
    val selectedTrash: Set<Uri> = emptySet(),
    val selectedContactGroups: Set<String> = emptySet(),
    val selectedIncompleteContactIds: Set<Long> = emptySet(),
    val selectedCalendarEventIds: Set<Long> = emptySet(),
    val isWorking: Boolean = false,
    val pendingTrash: PendingTrash? = null,
    val compressingVideo: MediaItem? = null,
    val compressionProgress: Float = 0f,
    val compressionResult: VideoCompressionResult? = null,
    val optimizingPhotos: Boolean = false,
    val photoOptimizationSummary: BatchPhotoOptimizationSummary? = null,
    val promptInAppReview: Boolean = false,
    val message: String? = null,
    val subscription: SubscriptionInfo = SubscriptionInfo(),
    val linkedAccount: LinkedAccount = LinkedAccount(),
    val lastCleanup: CleanupSummary? = null,
) {
    val hasPremium: Boolean get() = subscription.active
    val hasBatteryCare: Boolean get() = subscription.batteryCareActive
    val selectedItems: List<MediaItem> get() = media.everything.filter { it.uri in selectedMedia }
    val selectedBytes: Long get() = selectedItems.sumOf { it.size }
    val selectedTrashItems: List<MediaItem> get() = media.trashed.filter { it.uri in selectedTrash }
    val isBusy: Boolean get() = isScanning || isWorking || pendingTrash != null || compressingVideo != null || optimizingPhotos
}

class DashboardViewModel(application: Application) : AndroidViewModel(application) {
    private var rcActive: Boolean = false
    private var rcBatteryCare: Boolean = false
    private var serverActive: Boolean = false

    private val app: Application get() = getApplication()
    private val locApp get() = app.localized()

    /** StatFs storage-used fraction captured when a trash request starts (for the Cleaning Complete screen). */
    private var storageBeforeClean: Float? = null

    private val _state = MutableStateFlow(DashboardState(linkedAccount = Prefs.account.value))
    val state: StateFlow<DashboardState> = _state.asStateFlow()

    private fun isServerAccountCurrentlyEntitled(acc: Prefs.LinkedAccount?): Boolean {
        return acc != null &&
            acc.isSignedIn &&
            acc.serverActive &&
            !acc.plan.equals("addon_only", ignoreCase = true) &&
            (acc.expiresAt == 0L || acc.expiresAt > System.currentTimeMillis() / 1000L)
    }

    private fun isServerBatteryCareEntitled(acc: Prefs.LinkedAccount?): Boolean {
        return acc != null &&
            acc.isSignedIn &&
            (acc.expiresAt == 0L || acc.expiresAt > System.currentTimeMillis() / 1000L) &&
            (isServerAccountCurrentlyEntitled(acc) || acc.addons.any {
                it.equals("battery_care", ignoreCase = true) || it.equals("sweepr_secure_bundle", ignoreCase = true)
            })
    }

    private fun serverExpiresAtMillis(acc: Prefs.LinkedAccount?): Long? {
        val exp = acc?.expiresAt ?: 0L
        return if (exp > 0L) (if (exp > 10_000_000_000L) exp else exp * 1000L) else null
    }

    init {
        val linked = Prefs.account.value
        serverActive = isServerAccountCurrentlyEntitled(linked)
        val initialActive = rcActive || serverActive
        val initialBatteryCare = initialActive || rcBatteryCare || isServerBatteryCareEntitled(linked)
        BatteryCareManager.enforceEntitlement(application, initialActive || initialBatteryCare)
        _state.update { s ->
            s.copy(
                linkedAccount = linked,
                subscription = s.subscription.copy(
                    active = initialActive,
                    batteryCareActive = initialBatteryCare,
                    productId = s.subscription.productId ?: linked.plan,
                    expiresAt = s.subscription.expiresAt ?: serverExpiresAtMillis(linked),
                ),
            )
        }

        viewModelScope.launch {
            Prefs.account.collect { acc ->
                serverActive = isServerAccountCurrentlyEntitled(acc)
                val active = rcActive || serverActive
                val batActive = active || rcBatteryCare || isServerBatteryCareEntitled(acc)
                BatteryCareManager.enforceEntitlement(app, active || batActive)
                _state.update { s ->
                    s.copy(
                        linkedAccount = acc,
                        subscription = s.subscription.copy(
                            active = active,
                            batteryCareActive = batActive,
                            productId = if (rcActive) s.subscription.productId else (acc.plan ?: s.subscription.productId),
                            expiresAt = if (rcActive) s.subscription.expiresAt else (serverExpiresAtMillis(acc) ?: s.subscription.expiresAt),
                        ),
                    )
                }
            }
        }

        // RevenueCat is configured in SweeprApp.onCreate. Seed the state once, then listen
        // for changes (purchase, restore, renewal, expiry) so the UI unlocks instantly.
        runCatching {
            Purchases.sharedInstance.updatedCustomerInfoListener =
                UpdatedCustomerInfoListener { info -> updateCustomerInfo(info) }
        }
        refreshSubscriptionStatus()
    }

    /** Re-verifies both RevenueCat and cross-platform server entitlements (called on launch and on resume). */
    fun refreshSubscriptionStatus() {
        viewModelScope.launch {
            runCatching { updateCustomerInfo(Purchases.sharedInstance.awaitCustomerInfo()) }
            val linked = _state.value.linkedAccount
            if (linked.isSignedIn) {
                withContext(Dispatchers.IO) {
                    runCatching { SweeprAccountApi.refreshEntitlement(linked) }.onSuccess { updated ->
                        Prefs.setLinkedAccount(updated)
                        serverActive = isServerAccountCurrentlyEntitled(updated)
                        val active = rcActive || serverActive
                        val batActive = active || rcBatteryCare || isServerBatteryCareEntitled(updated)
                        BatteryCareManager.enforceEntitlement(app, active || batActive)
                        _state.update { s ->
                            s.copy(
                                linkedAccount = updated,
                                subscription = s.subscription.copy(
                                    active = active,
                                    batteryCareActive = batActive,
                                    expiresAt = if (rcActive) s.subscription.expiresAt else serverExpiresAtMillis(updated),
                                ),
                            )
                        }
                    }
                }
            } else {
                val active = rcActive || serverActive
                val batActive = active || rcBatteryCare || isServerBatteryCareEntitled(linked)
                BatteryCareManager.enforceEntitlement(app, active || batActive)
            }
        }
    }

    fun updateCustomerInfo(info: CustomerInfo) {
        val ent = info.entitlements.active[PREMIUM_ENTITLEMENT]
        val batEnt = info.entitlements.active[BATTERY_CARE_ENTITLEMENT]
        rcActive = ent != null
        rcBatteryCare = batEnt != null
        val acct = _state.value.linkedAccount
        serverActive = isServerAccountCurrentlyEntitled(acct)
        val active = rcActive || serverActive
        val batActive = active || rcBatteryCare || isServerBatteryCareEntitled(acct)
        BatteryCareManager.enforceEntitlement(app, active || batActive)
        val sub = SubscriptionInfo(
            active = active,
            batteryCareActive = batActive,
            productId = ent?.productIdentifier ?: acct.plan,
            expiresAt = ent?.expirationDate?.time ?: serverExpiresAtMillis(acct),
            willRenew = ent?.willRenew ?: serverActive,
            isTrial = ent?.periodType == PeriodType.TRIAL || ent?.periodType == PeriodType.INTRO,
            managementUrl = info.managementURL?.toString(),
            appUserId = runCatching { Purchases.sharedInstance.appUserID }.getOrDefault(acct.accountId),
        )
        _state.update { it.copy(subscription = sub) }
    }

    fun applyCustomerInfo(info: CustomerInfo) = updateCustomerInfo(info)

    private fun onAccountLinked(linked: Prefs.LinkedAccount) {
        serverActive = isServerAccountCurrentlyEntitled(linked)
        val active = rcActive || serverActive
        val batActive = active || rcBatteryCare || isServerBatteryCareEntitled(linked)
        BatteryCareManager.enforceEntitlement(app, active || batActive)
        _state.update { s ->
            s.copy(
                isWorking = false,
                linkedAccount = linked,
                subscription = s.subscription.copy(
                    active = active,
                    batteryCareActive = batActive,
                    productId = if (rcActive) s.subscription.productId else linked.plan,
                    expiresAt = if (rcActive) s.subscription.expiresAt else serverExpiresAtMillis(linked),
                ),
                message = locApp.getString(R.string.account_signed_in_as, linked.email),
            )
        }
    }

    private fun onAccountUnlinked(message: String, isWorking: Boolean = false) {
        val cleared = Prefs.account.value
        serverActive = isServerAccountCurrentlyEntitled(cleared)
        val active = rcActive || serverActive
        val batActive = active || rcBatteryCare || isServerBatteryCareEntitled(cleared)
        BatteryCareManager.enforceEntitlement(app, active || batActive)
        _state.update { s ->
            s.copy(
                isWorking = isWorking,
                linkedAccount = cleared,
                subscription = s.subscription.copy(
                    active = active,
                    batteryCareActive = batActive,
                ),
                message = message,
            )
        }
    }

    fun sendOtp(email: String, onSent: () -> Unit) {
        if (email.isBlank() || !email.contains("@")) {
            showMessage(locApp.getString(R.string.account_otp_invalid_email))
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(isWorking = true) }
            val result = withContext(Dispatchers.IO) {
                runCatching { SweeprAccountApi.sendOtp(email) }
            }
            _state.update { it.copy(isWorking = false) }
            result.onSuccess {
                showMessage(locApp.getString(R.string.account_otp_sent_to, email.trim()))
                onSent()
            }.onFailure { err ->
                showMessage(err.message ?: locApp.getString(R.string.account_otp_send_failed))
            }
        }
    }

    fun verifyOtp(email: String, code: String, onVerified: () -> Unit) {
        if (code.trim().length != 6) {
            showMessage(locApp.getString(R.string.account_otp_enter_6_digits))
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(isWorking = true) }
            val deviceId = Prefs.account.value.deviceId
            val result = withContext(Dispatchers.IO) {
                runCatching { SweeprAccountApi.verifyOtp(email, code, deviceId) }
            }
            result.onSuccess { linked ->
                Prefs.setLinkedAccount(linked)
                runCatching {
                    Purchases.sharedInstance.logIn(
                        linked.accountId,
                        object : LogInCallback {
                            override fun onReceived(customerInfo: CustomerInfo, created: Boolean) {
                                runCatching {
                                    Purchases.sharedInstance.setEmail(linked.email)
                                    Purchases.sharedInstance.setAttributes(mapOf("project_id" to BuildConfig.SWEEPR_PROJECT_ID))
                                }
                                updateCustomerInfo(customerInfo)
                            }
                            override fun onError(error: PurchasesError) = Unit
                        },
                    )
                }
                onAccountLinked(linked)
                onVerified()
            }.onFailure { err ->
                _state.update { it.copy(isWorking = false) }
                showMessage(err.message ?: locApp.getString(R.string.account_otp_invalid_code))
            }
        }
    }

    fun signOutAccount() {
        Prefs.clearLinkedAccount()
        runCatching { Purchases.sharedInstance.logOut(null) }
        onAccountUnlinked(message = locApp.getString(R.string.account_signed_out_msg))
        viewModelScope.launch {
            runCatching { updateCustomerInfo(Purchases.sharedInstance.awaitCustomerInfo()) }
        }
    }

    fun deleteAccount(onDeleted: () -> Unit) {
        val current = _state.value.linkedAccount
        if (!current.isSignedIn) return
        viewModelScope.launch {
            _state.update { it.copy(isWorking = true) }
            val res = withContext(Dispatchers.IO) {
                runCatching { SweeprAccountApi.deleteAccount(current) }
            }
            res.onSuccess {
                Prefs.clearLinkedAccount()
                runCatching { Purchases.sharedInstance.logOut(null) }
                onAccountUnlinked(message = locApp.getString(R.string.account_deleted_msg), isWorking = false)
                onDeleted()
            }.onFailure { err ->
                _state.update { it.copy(isWorking = false) }
                showMessage(err.message ?: locApp.getString(R.string.account_delete_failed_msg))
            }
        }
    }

    fun redeemReferralCode(code: String, onDone: () -> Unit = {}) {
        val current = _state.value.linkedAccount
        viewModelScope.launch {
            _state.update { it.copy(isWorking = true) }
            val res = withContext(Dispatchers.IO) {
                runCatching { SweeprAccountApi.redeemReferralCode(code, current) }
            }
            res.onSuccess { updated ->
                Prefs.setLinkedAccount(updated)
                serverActive = isServerAccountCurrentlyEntitled(updated)
                val active = rcActive || serverActive
                val batActive = active || rcBatteryCare || isServerBatteryCareEntitled(updated)
                BatteryCareManager.enforceEntitlement(app, active || batActive)
                _state.update { s ->
                    s.copy(
                        isWorking = false,
                        linkedAccount = updated,
                        subscription = s.subscription.copy(
                            active = active,
                            batteryCareActive = batActive,
                            productId = if (rcActive) s.subscription.productId else updated.plan,
                            expiresAt = if (rcActive) s.subscription.expiresAt else serverExpiresAtMillis(updated),
                        ),
                        message = "Referral code ${updated.redeemedReferralCode} applied! +30 days Pro unlocked.",
                    )
                }
                onDone()
            }.onFailure { err ->
                _state.update { it.copy(isWorking = false) }
                showMessage(err.message ?: "Could not apply referral code.")
            }
        }
    }

    /** Links this Android phone via a Flow A QR token (`ptk_...`) or approves a Flow B desktop QR challenge (`chk_...`). */
    fun handleQrPairInput(rawInput: String, onDone: () -> Unit = {}) {
        val trimmed = rawInput.trim()
        if (trimmed.isBlank()) {
            showMessage("Paste a QR pairing link or token first.")
            return
        }
        val current = _state.value.linkedAccount
        viewModelScope.launch {
            _state.update { it.copy(isWorking = true) }
            if (trimmed.contains("chk_") || trimmed.contains("mode=approve")) {
                val res = withContext(Dispatchers.IO) {
                    runCatching { SweeprAccountApi.approveDesktopQrChallenge(trimmed, current) }
                }
                _state.update { it.copy(isWorking = false) }
                res.onSuccess { pcName ->
                    showMessage("Approved $pcName! Your PC will unlock automatically.")
                    onDone()
                }.onFailure { err ->
                    showMessage(err.message ?: "Could not approve PC QR code.")
                }
            } else {
                val deviceId = current.deviceId
                val res = withContext(Dispatchers.IO) {
                    runCatching { SweeprAccountApi.redeemQrPairToken(trimmed, deviceId) }
                }
                res.onSuccess { linked ->
                    Prefs.setLinkedAccount(linked)
                    runCatching {
                        if (Purchases.isConfigured && linked.accountId.isNotBlank()) {
                            Purchases.sharedInstance.logIn(
                                linked.accountId,
                                object : LogInCallback {
                                    override fun onReceived(customerInfo: CustomerInfo, created: Boolean) {
                                        runCatching {
                                            if (linked.email.isNotBlank()) {
                                                Purchases.sharedInstance.setEmail(linked.email)
                                            }
                                            Purchases.sharedInstance.setAttributes(mapOf("project_id" to BuildConfig.SWEEPR_PROJECT_ID))
                                        }
                                        updateCustomerInfo(customerInfo)
                                    }
                                    override fun onError(error: PurchasesError) = Unit
                                },
                            )
                        }
                    }
                    onAccountLinked(linked)
                    onDone()
                }.onFailure { err ->
                    _state.update { it.copy(isWorking = false) }
                    showMessage(err.message ?: "Invalid or expired QR pairing token.")
                }
            }
        }
    }

    /** Syncs a Google Play purchase with the SWEEPR backend + Central CRM and updates local entitlement state. */
    fun syncGooglePlayPurchase(
        productId: String,
        purchaseToken: String,
        orderId: String? = null,
        isNewPurchase: Boolean = false,
    ) {
        val isAddonOnly = productId.contains("battery_care", ignoreCase = true)
        if (!isAddonOnly) {
            rcActive = true
        } else {
            rcBatteryCare = true
        }
        val current = _state.value.linkedAccount
        val localUpdated = current.copy(
            serverActive = if (isAddonOnly) current.serverActive else true,
            plan = if (isAddonOnly) (current.plan ?: "addon_only") else (current.plan ?: productId),
            expiresAt = if (current.expiresAt > 0L) current.expiresAt else (System.currentTimeMillis() / 1000L + 365L * 86400L),
            addons = if (isAddonOnly && !current.addons.contains("battery_care")) current.addons + "battery_care" else current.addons,
        )
        Prefs.setLinkedAccount(localUpdated)
        serverActive = isServerAccountCurrentlyEntitled(localUpdated)
        val immediateActive = rcActive || serverActive
        val immediateBatActive = immediateActive || rcBatteryCare || isServerBatteryCareEntitled(localUpdated)
        BatteryCareManager.enforceEntitlement(app, immediateActive || immediateBatActive)
        _state.update { s ->
            s.copy(
                linkedAccount = localUpdated,
                subscription = s.subscription.copy(
                    active = immediateActive,
                    batteryCareActive = immediateBatActive,
                    productId = if (!isAddonOnly) productId else (s.subscription.productId ?: productId),
                ),
                message = locApp.getString(if (isNewPurchase) R.string.acct_pro_unlocked else R.string.msg_premium_restored),
            )
        }

        viewModelScope.launch {
            val res = withContext(Dispatchers.IO) {
                runCatching {
                    SweeprAccountApi.verifyGooglePlayPurchase(
                        productId = productId,
                        purchaseToken = purchaseToken,
                        orderId = orderId,
                        current = current,
                    )
                }
            }
            res.onSuccess { updated ->
                Prefs.setLinkedAccount(updated)
                serverActive = isServerAccountCurrentlyEntitled(updated)
                val active = rcActive || serverActive
                val batActive = active || rcBatteryCare || isServerBatteryCareEntitled(updated)
                BatteryCareManager.enforceEntitlement(app, active || batActive)
                _state.update { s ->
                    s.copy(
                        linkedAccount = updated,
                        subscription = s.subscription.copy(
                            active = active,
                            batteryCareActive = batActive,
                            productId = s.subscription.productId ?: updated.plan,
                            expiresAt = s.subscription.expiresAt ?: serverExpiresAtMillis(updated),
                        ),
                    )
                }
            }
        }
    }

    /** Submits an in-app support ticket directly to POST /v1/support (synced to Central CRM). */
    fun submitSupportTicket(
        email: String,
        subject: String,
        message: String,
        onDone: () -> Unit = {},
    ) {
        if (email.isBlank() || !email.contains("@")) {
            showMessage("Please enter a valid contact email.")
            return
        }
        if (subject.trim().length < 2 || message.trim().length < 5) {
            showMessage("Please enter a subject and message.")
            return
        }
        val current = _state.value.linkedAccount
        viewModelScope.launch {
            _state.update { it.copy(isWorking = true) }
            val logs = "Android ${android.os.Build.VERSION.RELEASE} (${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}), plan=${current.plan ?: "free"}, device=${current.deviceId}"
            val res = withContext(Dispatchers.IO) {
                runCatching {
                    SweeprAccountApi.submitSupportTicket(
                        email = email,
                        subject = subject,
                        message = message,
                        logs = logs,
                        current = current,
                    )
                }
            }
            _state.update { it.copy(isWorking = false) }
            res.onSuccess {
                showMessage("Support ticket submitted! Our team will reply to ${email.trim()}.")
                onDone()
            }.onFailure { err ->
                showMessage(err.message ?: "Could not submit support ticket. Please email $SUPPORT_EMAIL.")
            }
        }
    }

    /** Re-attaches a Google Play subscription bought earlier (new phone, reinstall). */
    fun restorePurchases() {
        _state.update { it.copy(isWorking = true) }
        PlayBillingManager.queryActivePurchases(app) { activePlayPurchases ->
            for (purchase in activePlayPurchases) {
                val prodId = purchase.products.firstOrNull() ?: "sweepr_annual_4999"
                syncGooglePlayPurchase(
                    productId = prodId,
                    purchaseToken = purchase.purchaseToken,
                    orderId = purchase.orderId,
                )
            }
            viewModelScope.launch {
                val linked = _state.value.linkedAccount
                if (linked.isSignedIn) {
                    withContext(Dispatchers.IO) {
                        runCatching { SweeprAccountApi.refreshEntitlement(linked) }.onSuccess { updated ->
                            Prefs.setLinkedAccount(updated)
                            serverActive = isServerAccountCurrentlyEntitled(updated)
                            val active = rcActive || serverActive
                            val batActive = active || rcBatteryCare || isServerBatteryCareEntitled(updated)
                            BatteryCareManager.enforceEntitlement(app, active || batActive)
                            _state.update { s ->
                                s.copy(
                                    linkedAccount = updated,
                                    subscription = s.subscription.copy(
                                        active = active,
                                        batteryCareActive = batActive,
                                        expiresAt = if (rcActive) s.subscription.expiresAt else serverExpiresAtMillis(updated),
                                    ),
                                )
                            }
                        }
                    }
                }
                val finishRestore = {
                    _state.update { s ->
                        val restored = s.hasPremium || s.hasBatteryCare
                        s.copy(
                            isWorking = false,
                            message = if (restored) locApp.getString(R.string.msg_premium_restored) else locApp.getString(R.string.msg_no_subscription_found),
                        )
                    }
                }
                if (Purchases.isConfigured && BuildConfig.REVENUECAT_API_KEY.startsWith("goog_")) {
                    Purchases.sharedInstance.restorePurchasesWith(
                        onError = { _ ->
                            finishRestore()
                        },
                        onSuccess = { info ->
                            applyCustomerInfo(info)
                            finishRestore()
                        },
                    )
                } else {
                    finishRestore()
                }
            }
        }
    }

    fun scan(permissions: PermissionState) {
        if (_state.value.isScanning) return
        viewModelScope.launch {
            _state.update { it.copy(isScanning = true, scanStatus = locApp.getString(R.string.scan_status_media)) }
            val media = if (permissions.media) {
                withContext(Dispatchers.IO) { runCatching { MediaScanner.scan(app) }.getOrDefault(MediaScanResult()) }
            } else MediaScanResult()

            _state.update { it.copy(scanStatus = locApp.getString(R.string.scan_status_contacts)) }
            val contacts = if (permissions.contactsRead) {
                withContext(Dispatchers.IO) { runCatching { ContactsScanner.scan(app) }.getOrDefault(emptyList()) }
            } else emptyList()
            val incomplete = if (permissions.contactsRead) {
                withContext(Dispatchers.IO) { runCatching { ContactsScanner.scanIncomplete(app) }.getOrDefault(emptyList()) }
            } else emptyList()

            // Keep Best Shot (group.keep) unselected; pre-select duplicate & similar extras + screenshots
            val preselected = (media.duplicateGroups + media.similarGroups)
                .flatMap { g -> g.extras.map { it.uri } }
                .plus(media.screenshots.map { it.uri })
                .toSet()

            _state.update {
                it.copy(
                    isScanning = false,
                    hasScanned = true,
                    scanStatus = "",
                    media = media,
                    contactGroups = contacts,
                    incompleteContacts = incomplete,
                    selectedMedia = preselected,
                    selectedTrash = emptySet(),
                    selectedContactGroups = contacts.map { g -> g.key }.toSet(),
                    selectedIncompleteContactIds = incomplete.map { c -> c.contactId }.toSet(),
                )
            }
            StorageWidgetProvider.refreshAll(app)
        }
    }

    fun toggleIncompleteContact(id: Long) = _state.update { s ->
        s.copy(
            selectedIncompleteContactIds = if (id in s.selectedIncompleteContactIds) s.selectedIncompleteContactIds - id
            else s.selectedIncompleteContactIds + id,
        )
    }

    fun setIncompleteContactsSelected(ids: Collection<Long>, selected: Boolean) = _state.update { s ->
        s.copy(
            selectedIncompleteContactIds = if (selected) s.selectedIncompleteContactIds + ids
            else s.selectedIncompleteContactIds - ids.toSet(),
        )
    }

    fun deleteIncompleteContacts(ids: Set<Long>) {
        if (!_state.value.hasPremium || ids.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(isWorking = true) }
            val deleted = withContext(Dispatchers.IO) {
                runCatching { ContactsScanner.deleteContacts(app, ids) }.getOrDefault(0)
            }
            val shouldAskReview = if (deleted > 0) Prefs.recordCleanupForReviewPrompt() else false
            _state.update { s ->
                s.copy(
                    isWorking = false,
                    incompleteContacts = s.incompleteContacts.filterNot { it.contactId in ids },
                    selectedIncompleteContactIds = s.selectedIncompleteContactIds - ids,
                    promptInAppReview = s.promptInAppReview || shouldAskReview,
                    message = if (deleted > 0) "Deleted $deleted incomplete contact(s)." else locApp.getString(R.string.msg_nothing_deleted),
                )
            }
        }
    }

    fun toggleMedia(uri: Uri) = _state.update { s ->
        s.copy(selectedMedia = if (uri in s.selectedMedia) s.selectedMedia - uri else s.selectedMedia + uri)
    }

    fun setMediaSelected(uris: Collection<Uri>, selected: Boolean) = _state.update { s ->
        s.copy(selectedMedia = if (selected) s.selectedMedia + uris else s.selectedMedia - uris.toSet())
    }

    fun toggleTrash(uri: Uri) = _state.update { s ->
        s.copy(selectedTrash = if (uri in s.selectedTrash) s.selectedTrash - uri else s.selectedTrash + uri)
    }

    fun setTrashSelected(uris: Collection<Uri>, selected: Boolean) = _state.update { s ->
        s.copy(selectedTrash = if (selected) s.selectedTrash + uris else s.selectedTrash - uris.toSet())
    }

    fun toggleContactGroup(key: String) = _state.update { s ->
        s.copy(
            selectedContactGroups = if (key in s.selectedContactGroups) s.selectedContactGroups - key
            else s.selectedContactGroups + key,
        )
    }

    fun showMessage(message: String) = _state.update { it.copy(message = message) }

    fun clearMessage() = _state.update { it.copy(message = null) }

    fun clearReviewPrompt() = _state.update { it.copy(promptInAppReview = false) }

    /**
     * Compresses a video using [VideoCompressor] into `Movies/Sweepr`, keeping the original
     * until the user explicitly confirms moving the original to System Trash.
     */
    fun compressVideo(item: MediaItem, preset: CompressionPreset = CompressionPreset.COMPACT_720P) {
        if (!_state.value.hasPremium || _state.value.compressingVideo != null) return
        viewModelScope.launch {
            _state.update {
                it.copy(
                    compressingVideo = item,
                    compressionProgress = 0.05f,
                    compressionResult = null,
                )
            }
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    VideoCompressor.compress(app, item, preset) { progress ->
                        _state.update { s -> s.copy(compressionProgress = progress) }
                    }
                }
            }
            result.onSuccess { res ->
                _state.update {
                    it.copy(
                        compressingVideo = null,
                        compressionProgress = 1f,
                        compressionResult = res,
                    )
                }
            }.onFailure { err ->
                _state.update {
                    it.copy(
                        compressingVideo = null,
                        compressionProgress = 0f,
                        message = locApp.getString(R.string.compressor_failed, err.message ?: ""),
                    )
                }
            }
        }
    }

    fun clearCompressionResult() = _state.update { it.copy(compressionResult = null) }

    fun optimizePhotos(
        items: List<MediaItem>,
        compressResolution: Boolean,
        stripGps: Boolean,
        preset: PhotoCompressionPreset = PhotoCompressionPreset.BALANCED,
    ) {
        if (!_state.value.hasPremium || items.isEmpty() || _state.value.optimizingPhotos) return
        viewModelScope.launch {
            _state.update {
                it.copy(
                    optimizingPhotos = true,
                    photoOptimizationSummary = null,
                )
            }
            val results = withContext(Dispatchers.IO) {
                items.mapNotNull { item ->
                    runCatching {
                        PhotoOptimizer.optimizePhoto(app, item, compressResolution, stripGps, preset)
                    }.getOrNull()
                }
            }
            if (results.isNotEmpty()) {
                _state.update {
                    it.copy(
                        optimizingPhotos = false,
                        photoOptimizationSummary = BatchPhotoOptimizationSummary(results),
                    )
                }
            } else {
                _state.update {
                    it.copy(
                        optimizingPhotos = false,
                        message = locApp.getString(R.string.photo_opt_failed),
                    )
                }
            }
        }
    }

    fun clearPhotoOptimizationResult() = _state.update { it.copy(photoOptimizationSummary = null) }

    fun scanCalendarEvents() {
        viewModelScope.launch {
            val events = withContext(Dispatchers.IO) {
                runCatching { ContactsCleaner.scanOldCalendarEvents(app) }.getOrDefault(emptyList())
            }
            _state.update {
                it.copy(
                    oldCalendarEvents = events,
                    selectedCalendarEventIds = events.map { ev -> ev.id }.toSet(),
                )
            }
        }
    }

    fun toggleCalendarEvent(id: Long) = _state.update { s ->
        s.copy(
            selectedCalendarEventIds = if (id in s.selectedCalendarEventIds) s.selectedCalendarEventIds - id
            else s.selectedCalendarEventIds + id,
        )
    }

    fun setCalendarEventsSelected(ids: Collection<Long>, selected: Boolean) = _state.update { s ->
        s.copy(
            selectedCalendarEventIds = if (selected) s.selectedCalendarEventIds + ids
            else s.selectedCalendarEventIds - ids.toSet(),
        )
    }

    fun deleteCalendarEvents(ids: Set<Long>) {
        if (!_state.value.hasPremium || ids.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(isWorking = true) }
            val deleted = withContext(Dispatchers.IO) {
                runCatching { ContactsCleaner.deleteCalendarEvents(app, ids) }.getOrDefault(0)
            }
            val shouldAskReview = if (deleted > 0) Prefs.recordCleanupForReviewPrompt() else false
            _state.update { s ->
                s.copy(
                    isWorking = false,
                    oldCalendarEvents = s.oldCalendarEvents.filterNot { it.id in ids },
                    selectedCalendarEventIds = s.selectedCalendarEventIds - ids,
                    promptInAppReview = s.promptInAppReview || shouldAskReview,
                    message = if (deleted > 0) {
                        locApp.resources.getQuantityString(R.plurals.msg_calendar_events_deleted, deleted, deleted)
                    } else {
                        locApp.getString(R.string.msg_nothing_deleted)
                    },
                )
            }
        }
    }

    /**
     * Moves media to the system trash. On Android 11+ (API 30+), uses
     * [MediaStore.createTrashRequest] with `isTrashed = true` so items go to the 30-day System Trash
     * instead of permanent deletion.
     */
    fun requestTrash(items: List<MediaItem>) {
        if (!_state.value.hasPremium || items.isEmpty() || _state.value.pendingTrash != null) return
        storageBeforeClean = readStorage().takeIf { it.total > 0 }?.fraction
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                val request = MediaStore.createTrashRequest(app.contentResolver, items.map { it.uri }, true)
                _state.update { it.copy(pendingTrash = PendingTrash(items, request.intentSender, isRestore = false)) }
            } catch (e: Exception) {
                showMessage(locApp.getString(R.string.msg_cleanup_start_failed, e.message))
            }
        } else {
            viewModelScope.launch {
                _state.update { it.copy(isWorking = true) }
                val deleted = withContext(Dispatchers.IO) {
                    items.filter { item ->
                        runCatching { app.contentResolver.delete(item.uri, null, null) > 0 }.getOrDefault(false)
                    }
                }
                _state.update { it.copy(isWorking = false) }
                removeMedia(deleted, isTrash = false)
            }
        }
    }

    /**
     * Restores trashed media from the Android 11+ 30-day System Trash using
     * `MediaStore.createTrashRequest(contentResolver, uris, false)`.
     */
    fun requestRestoreFromTrash(items: List<MediaItem>) {
        if (items.isEmpty() || _state.value.pendingTrash != null) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                val request = MediaStore.createTrashRequest(app.contentResolver, items.map { it.uri }, false)
                _state.update { it.copy(pendingTrash = PendingTrash(items, request.intentSender, isRestore = true)) }
            } catch (e: Exception) {
                showMessage(locApp.getString(R.string.msg_restore_trash_failed, e.message ?: ""))
            }
        }
    }

    /** Called with the result of the Android confirmation dialog. */
    fun onTrashResult(confirmed: Boolean) {
        val pending = _state.value.pendingTrash ?: return
        _state.update { it.copy(pendingTrash = null) }
        if (confirmed) {
            if (pending.isRestore) {
                restoreTrashedMedia(pending.items)
            } else {
                removeMedia(pending.items, isTrash = true)
            }
        } else {
            showMessage(locApp.getString(R.string.msg_cleanup_cancelled))
        }
    }

    private fun restoreTrashedMedia(items: List<MediaItem>) {
        val restoredUris = items.map { it.uri }.toSet()
        val unTrashed = items.map { it.copy(isTrashed = false, dateExpiresMs = 0L) }
        _state.update { s ->
            val currentMedia = s.media
            s.copy(
                media = currentMedia.copy(
                    trashed = currentMedia.trashed.filter { it.uri !in restoredUris },
                    everything = (unTrashed + currentMedia.everything).distinctBy { it.uri }.sortedByDescending { it.dateTaken },
                ),
                selectedTrash = s.selectedTrash - restoredUris,
                message = locApp.resources.getQuantityString(R.plurals.msg_restored_from_trash, items.size, items.size),
            )
        }
        StorageWidgetProvider.refreshAll(app)
    }

    private fun removeMedia(items: List<MediaItem>, isTrash: Boolean) {
        if (items.isEmpty()) {
            showMessage(locApp.getString(R.string.msg_nothing_deleted))
            return
        }
        val uris = items.map { it.uri }.toSet()
        val bytes = items.sumOf { it.size }
        val shouldAskReview = Prefs.recordCleanupForReviewPrompt()
        val summary = CleanupSummary(
            fileCount = items.size,
            bytes = bytes,
            movedToTrash = isTrash,
            storageBefore = storageBeforeClean,
            storageAfter = readStorage().takeIf { it.total > 0 }?.fraction,
        )
        storageBeforeClean = null
        _state.update { s ->
            val formattedBytes = formatBytes(bytes)
            val msg = if (isTrash) {
                locApp.resources.getQuantityString(R.plurals.msg_freed_trashed, items.size, formattedBytes, items.size)
            } else {
                locApp.resources.getQuantityString(R.plurals.msg_freed_deleted, items.size, formattedBytes, items.size)
            }
            s.copy(
                media = s.media.without(uris, movedToTrash = if (isTrash) items else emptyList()),
                selectedMedia = s.selectedMedia - uris,
                promptInAppReview = s.promptInAppReview || shouldAskReview,
                message = msg,
                lastCleanup = summary,
            )
        }
        StorageWidgetProvider.refreshAll(app)
    }

    fun clearCleanupSummary() = _state.update { it.copy(lastCleanup = null) }

    /** Selects / deselects every given contact group (used by the Quick Clean review checkbox). */
    fun setContactGroupsSelected(keys: Collection<String>, selected: Boolean) = _state.update { s ->
        s.copy(
            selectedContactGroups = if (selected) s.selectedContactGroups + keys else s.selectedContactGroups - keys.toSet(),
        )
    }

    fun mergeContactGroups(keys: Set<String>) {
        if (!_state.value.hasPremium) return
        val groups = _state.value.contactGroups.filter { it.key in keys }
        if (groups.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(isWorking = true) }
            val merged = withContext(Dispatchers.IO) {
                groups.filter { g -> runCatching { ContactsScanner.merge(app, g) }.isSuccess }.map { it.key }.toSet()
            }
            val shouldAskReview = if (merged.isNotEmpty()) Prefs.recordCleanupForReviewPrompt() else false
            _state.update { s ->
                s.copy(
                    isWorking = false,
                    contactGroups = s.contactGroups.filterNot { it.key in merged },
                    selectedContactGroups = s.selectedContactGroups - merged,
                    promptInAppReview = s.promptInAppReview || shouldAskReview,
                    message = if (merged.isEmpty()) locApp.getString(R.string.msg_merge_failed)
                    else locApp.resources.getQuantityString(R.plurals.msg_merged, merged.size, merged.size),
                )
            }
        }
    }

    /** "Clean Up Now": merges the selected contacts and trashes all selected media. */
    fun cleanUpSelected(permissions: PermissionState) {
        val s = _state.value
        if (!s.hasPremium) return
        if (s.selectedContactGroups.isNotEmpty()) {
            if (permissions.contactsWrite) mergeContactGroups(s.selectedContactGroups)
            else showMessage(locApp.getString(R.string.msg_allow_contacts_merge))
        }
        requestTrash(s.selectedItems)
    }
}
