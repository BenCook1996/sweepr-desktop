package com.sweepr.app

import android.app.Application
import android.content.IntentSender
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.PeriodType
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.awaitCustomerInfo
import com.revenuecat.purchases.interfaces.UpdatedCustomerInfoListener
import com.revenuecat.purchases.restorePurchasesWith

/** A delete request waiting for the user to confirm it in the Android system dialog. */
data class PendingTrash(val items: List<MediaItem>, val intentSender: IntentSender)

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
    val selectedMedia: Set<Uri> = emptySet(),
    val selectedContactGroups: Set<String> = emptySet(),
    val isWorking: Boolean = false,
    val pendingTrash: PendingTrash? = null,
    val message: String? = null,
    val subscription: SubscriptionInfo = SubscriptionInfo(),
) {
    val hasPremium: Boolean get() = subscription.active
    val selectedItems: List<MediaItem> get() = media.everything.filter { it.uri in selectedMedia }
    val selectedBytes: Long get() = selectedItems.sumOf { it.size }
    val isBusy: Boolean get() = isScanning || isWorking || pendingTrash != null
}

class DashboardViewModel(application: Application) : AndroidViewModel(application) {
    private val _state = MutableStateFlow(DashboardState())
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
    }

    private fun applyCustomerInfo(info: CustomerInfo) {
        val ent = info.entitlements.active[PREMIUM_ENTITLEMENT]
        val sub = SubscriptionInfo(
            active = ent != null,
            productId = ent?.productIdentifier,
            expiresAt = ent?.expirationDate?.time,
            willRenew = ent?.willRenew ?: false,
            isTrial = ent?.periodType == PeriodType.TRIAL || ent?.periodType == PeriodType.INTRO,
            managementUrl = info.managementURL?.toString(),
            appUserId = runCatching { Purchases.sharedInstance.appUserID }.getOrDefault(""),
        )
        _state.update { it.copy(subscription = sub) }
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
                    selectedContactGroups = contacts.map { g -> g.key }.toSet(),
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

    fun toggleContactGroup(key: String) = _state.update { s ->
        s.copy(
            selectedContactGroups = if (key in s.selectedContactGroups) s.selectedContactGroups - key
            else s.selectedContactGroups + key,
        )
    }

    fun showMessage(message: String) = _state.update { it.copy(message = message) }

    fun clearMessage() = _state.update { it.copy(message = null) }

    /**
     * Moves media to the system trash. On Android 11+ Android shows its own confirmation dialog,
     * and trashed items can be recovered for 30 days before they're removed for good.
     */
    fun requestTrash(items: List<MediaItem>) {
        if (items.isEmpty() || _state.value.pendingTrash != null) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                val request = MediaStore.createTrashRequest(app.contentResolver, items.map { it.uri }, true)
                _state.update { it.copy(pendingTrash = PendingTrash(items, request.intentSender)) }
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

    /** Called with the result of the Android confirmation dialog. */
    fun onTrashResult(confirmed: Boolean) {
        val pending = _state.value.pendingTrash ?: return
        _state.update { it.copy(pendingTrash = null) }
        if (confirmed) removeMedia(pending.items, isTrash = true)
        else showMessage(app.getString(R.string.msg_cleanup_cancelled))
    }

    private fun removeMedia(items: List<MediaItem>, isTrash: Boolean) {
        if (items.isEmpty()) {
            showMessage(app.getString(R.string.msg_nothing_deleted))
            return
        }
        val uris = items.map { it.uri }.toSet()
        val bytes = items.sumOf { it.size }
        _state.update { s ->
            val formattedBytes = formatBytes(bytes)
            val msg = if (isTrash) {
                app.resources.getQuantityString(R.plurals.msg_freed_trashed, items.size, formattedBytes, items.size)
            } else {
                app.resources.getQuantityString(R.plurals.msg_freed_deleted, items.size, formattedBytes, items.size)
            }
            s.copy(
                media = s.media.without(uris),
                selectedMedia = s.selectedMedia - uris,
                message = msg,
            )
        }
    }

    fun mergeContactGroups(keys: Set<String>) {
        val groups = _state.value.contactGroups.filter { it.key in keys }
        if (groups.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(isWorking = true) }
            val merged = withContext(Dispatchers.IO) {
                groups.filter { g -> runCatching { ContactsScanner.merge(app, g) }.isSuccess }.map { it.key }.toSet()
            }
            _state.update { s ->
                s.copy(
                    isWorking = false,
                    contactGroups = s.contactGroups.filterNot { it.key in merged },
                    selectedContactGroups = s.selectedContactGroups - merged,
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
