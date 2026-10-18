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
    val productId: String? = null,
    val expiresAt: Long? = null,
    val willRenew: Boolean = false,
    val isTrial: Boolean = false,
    val managementUrl: String? = null,
    val appUserId: String = "",
)

const val PREMIUM_ENTITLEMENT = "premium"

data class DashboardState(
    val isScanning: Boolean = false,
    val hasScanned: Boolean = false,
    val scanStatus: String = "",
    val media: MediaScanResult = MediaScanResult(),
    val contactGroups: List<ContactGroup> = emptyList(),
    val oldCalendarEvents: List<OldCalendarEvent> = emptyList(),
    val selectedMedia: Set<Uri> = emptySet(),
    val selectedTrash: Set<Uri> = emptySet(),
    val selectedContactGroups: Set<String> = emptySet(),
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
) {
    val hasPremium: Boolean get() = subscription.active || linkedAccount.serverActive
    val selectedItems: List<MediaItem> get() = media.everything.filter { it.uri in selectedMedia }
    val selectedBytes: Long get() = selectedItems.sumOf { it.size }
    val selectedTrashItems: List<MediaItem> get() = media.trashed.filter { it.uri in selectedTrash }
    val isBusy: Boolean get() = isScanning || isWorking || pendingTrash != null || compressingVideo != null || optimizingPhotos
}

class DashboardViewModel(application: Application) : AndroidViewModel(application) {
    private val _state = MutableStateFlow(DashboardState(linkedAccount = Prefs.account.value))
    val state: StateFlow<DashboardState> = _state.asStateFlow()

    init {
        // RevenueCat is configured in SweeprApp.onCreate. Seed the state once, then listen
        // for changes (purchase, restore, renewal, expiry) so the UI unlocks instantly.
        runCatching {
            Purchases.sharedInstance.updatedCustomerInfoListener =
                UpdatedCustomerInfoListener { info -> applyCustomerInfo(info) }
            viewModelScope.launch {
                runCatching { applyCustomerInfo(Purchases.sharedInstance.awaitCustomerInfo()) }
            }
        }
        viewModelScope.launch {
            val existing = Prefs.account.value
            if (existing.isSignedIn) {
                withContext(Dispatchers.IO) {
                    runCatching { SweeprAccountApi.refreshEntitlement(existing) }.onSuccess { updated ->
                        Prefs.setLinkedAccount(updated)
                        _state.update { s ->
                            s.copy(
                                linkedAccount = updated,
                                subscription = s.subscription.copy(
                                    active = s.subscription.active || updated.serverActive,
                                    expiresAt = s.subscription.expiresAt ?: updated.expiresAt,
                                ),
                            )
                        }
                    }
                }
            }
        }
    }

    fun applyCustomerInfo(info: CustomerInfo) {
        val ent = info.entitlements.active[PREMIUM_ENTITLEMENT]
        val acct = _state.value.linkedAccount
        val sub = SubscriptionInfo(
            active = ent != null || acct.serverActive,
            productId = ent?.productIdentifier ?: acct.plan,
            expiresAt = ent?.expirationDate?.time ?: acct.expiresAt,
            willRenew = ent?.willRenew ?: acct.serverActive,
            isTrial = ent?.periodType == PeriodType.TRIAL || ent?.periodType == PeriodType.INTRO,
            managementUrl = info.managementURL?.toString(),
            appUserId = runCatching { Purchases.sharedInstance.appUserID }.getOrDefault(acct.accountId),
        )
        _state.update { it.copy(subscription = sub) }
    }

    fun sendOtp(email: String, onSent: () -> Unit) {
        if (email.isBlank() || !email.contains("@")) {
            showMessage(app.getString(R.string.account_otp_invalid_email))
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(isWorking = true) }
            val result = withContext(Dispatchers.IO) {
                runCatching { SweeprAccountApi.sendOtp(email) }
            }
            _state.update { it.copy(isWorking = false) }
            result.onSuccess {
                showMessage(app.getString(R.string.account_otp_sent_to, email.trim()))
                onSent()
            }.onFailure { err ->
                showMessage(err.message ?: app.getString(R.string.account_otp_send_failed))
            }
        }
    }

    fun verifyOtp(email: String, code: String, onVerified: () -> Unit) {
        if (code.trim().length != 6) {
            showMessage(app.getString(R.string.account_otp_enter_6_digits))
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
                                applyCustomerInfo(customerInfo)
                            }
                            override fun onError(error: PurchasesError) = Unit
                        },
                    )
                }
                _state.update { s ->
                    s.copy(
                        isWorking = false,
                        linkedAccount = linked,
                        subscription = s.subscription.copy(
                            active = s.subscription.active || linked.serverActive,
                            productId = s.subscription.productId ?: linked.plan,
                            expiresAt = s.subscription.expiresAt ?: linked.expiresAt,
                        ),
                        message = app.getString(R.string.account_signed_in_as, linked.email),
                    )
                }
                onVerified()
            }.onFailure { err ->
                _state.update { it.copy(isWorking = false) }
                showMessage(err.message ?: app.getString(R.string.account_otp_invalid_code))
            }
        }
    }

    fun signOutAccount() {
        Prefs.clearLinkedAccount()
        runCatching { Purchases.sharedInstance.logOut(null) }
        val cleared = Prefs.account.value
        _state.update { s ->
            s.copy(
                linkedAccount = cleared,
                subscription = s.subscription.copy(active = false),
                message = app.getString(R.string.account_signed_out_msg),
            )
        }
        viewModelScope.launch {
            runCatching { applyCustomerInfo(Purchases.sharedInstance.awaitCustomerInfo()) }
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
                _state.update { s ->
                    s.copy(
                        isWorking = false,
                        linkedAccount = Prefs.account.value,
                        subscription = s.subscription.copy(active = false),
                        message = app.getString(R.string.account_deleted_msg),
                    )
                }
                onDeleted()
            }.onFailure { err ->
                _state.update { it.copy(isWorking = false) }
                showMessage(err.message ?: app.getString(R.string.account_delete_failed_msg))
            }
        }
    }

    /** Re-attaches a Google Play subscription bought earlier (new phone, reinstall). */
    fun restorePurchases() {
        _state.update { it.copy(isWorking = true) }
        Purchases.sharedInstance.restorePurchasesWith(
            onError = { error ->
                _state.update { it.copy(isWorking = false, message = app.getString(R.string.msg_restore_failed, error.message)) }
            },
            onSuccess = { info ->
                applyCustomerInfo(info)
                _state.update {
                    it.copy(
                        isWorking = false,
                        message = if (it.hasPremium) app.getString(R.string.msg_premium_restored) else app.getString(R.string.msg_no_subscription_found),
                    )
                }
            },
        )
    }

    private val app: Application get() = getApplication()

    fun scan(permissions: PermissionState) {
        if (_state.value.isScanning) return
        viewModelScope.launch {
            _state.update { it.copy(isScanning = true, scanStatus = app.getString(R.string.scan_status_media)) }
            val media = if (permissions.media) {
                withContext(Dispatchers.IO) { runCatching { MediaScanner.scan(app) }.getOrDefault(MediaScanResult()) }
            } else MediaScanResult()

            _state.update { it.copy(scanStatus = app.getString(R.string.scan_status_contacts)) }
            val contacts = if (permissions.contactsRead) {
                withContext(Dispatchers.IO) { runCatching { ContactsScanner.scan(app) }.getOrDefault(emptyList()) }
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
                    selectedMedia = preselected,
                    selectedTrash = emptySet(),
                    selectedContactGroups = contacts.map { g -> g.key }.toSet(),
                )
            }
            StorageWidgetProvider.refreshAll(app)
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
        if (_state.value.compressingVideo != null) return
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
                        message = app.getString(R.string.compressor_failed, err.message ?: ""),
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
    ) {
        if (items.isEmpty() || _state.value.optimizingPhotos) return
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
                        PhotoOptimizer.optimizePhoto(app, item, compressResolution, stripGps)
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
                        message = app.getString(R.string.photo_opt_failed),
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
        if (ids.isEmpty()) return
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
                        app.resources.getQuantityString(R.plurals.msg_calendar_events_deleted, deleted, deleted)
                    } else {
                        app.getString(R.string.msg_nothing_deleted)
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
        if (items.isEmpty() || _state.value.pendingTrash != null) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                val request = MediaStore.createTrashRequest(app.contentResolver, items.map { it.uri }, true)
                _state.update { it.copy(pendingTrash = PendingTrash(items, request.intentSender, isRestore = false)) }
            } catch (e: Exception) {
                showMessage(app.getString(R.string.msg_cleanup_start_failed, e.message))
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
                showMessage(app.getString(R.string.msg_restore_trash_failed, e.message ?: ""))
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
            showMessage(app.getString(R.string.msg_cleanup_cancelled))
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
                message = app.resources.getQuantityString(R.plurals.msg_restored_from_trash, items.size, items.size),
            )
        }
        StorageWidgetProvider.refreshAll(app)
    }

    private fun removeMedia(items: List<MediaItem>, isTrash: Boolean) {
        if (items.isEmpty()) {
            showMessage(app.getString(R.string.msg_nothing_deleted))
            return
        }
        val uris = items.map { it.uri }.toSet()
        val bytes = items.sumOf { it.size }
        val shouldAskReview = Prefs.recordCleanupForReviewPrompt()
        _state.update { s ->
            val formattedBytes = formatBytes(bytes)
            val msg = if (isTrash) {
                app.resources.getQuantityString(R.plurals.msg_freed_trashed, items.size, formattedBytes, items.size)
            } else {
                app.resources.getQuantityString(R.plurals.msg_freed_deleted, items.size, formattedBytes, items.size)
            }
            s.copy(
                media = s.media.without(uris, movedToTrash = if (isTrash) items else emptyList()),
                selectedMedia = s.selectedMedia - uris,
                promptInAppReview = s.promptInAppReview || shouldAskReview,
                message = msg,
            )
        }
        StorageWidgetProvider.refreshAll(app)
    }

    fun mergeContactGroups(keys: Set<String>) {
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
                    message = if (merged.isEmpty()) app.getString(R.string.msg_merge_failed)
                    else app.resources.getQuantityString(R.plurals.msg_merged, merged.size, merged.size),
                )
            }
        }
    }

    /** "Clean Up Now": merges the selected contacts and trashes all selected media. */
    fun cleanUpSelected(permissions: PermissionState) {
        val s = _state.value
        if (s.selectedContactGroups.isNotEmpty()) {
            if (permissions.contactsWrite) mergeContactGroups(s.selectedContactGroups)
            else showMessage(app.getString(R.string.msg_allow_contacts_merge))
        }
        requestTrash(s.selectedItems)
    }
}
