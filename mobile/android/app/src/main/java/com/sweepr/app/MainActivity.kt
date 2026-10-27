package com.sweepr.app

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesError
import com.revenuecat.purchases.interfaces.GetStoreProductsCallback
import com.revenuecat.purchases.interfaces.PurchaseCallback
import com.revenuecat.purchases.models.StoreProduct
import com.revenuecat.purchases.models.StoreTransaction
import com.revenuecat.purchases.ui.revenuecatui.activity.PaywallActivityLauncher
import com.revenuecat.purchases.ui.revenuecatui.activity.PaywallResult
import com.revenuecat.purchases.ui.revenuecatui.activity.PaywallResultHandler

class MainActivity : AppCompatActivity() {
    private lateinit var paywallLauncher: PaywallActivityLauncher

    /** What the user was trying to do when the paywall opened – resumed after they subscribe. */
    private var afterPurchase: (() -> Unit)? = null
    private var pendingDeepLinkPair by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PlayBillingManager.init(this)
        PlayAppUpdateManager.checkAndPrompt(this)
        extractDeepLinkPair(intent)

        // Must be created in onCreate. Scanning is free; cleaning is Premium (Google Play
        // subscription via RevenueCat). If they subscribe or restore, carry on with the clean.
        paywallLauncher = PaywallActivityLauncher(
            resultCaller = this,
            resultHandler = object : PaywallResultHandler {
                override fun onActivityResult(result: PaywallResult) {
                    val action = afterPurchase
                    afterPurchase = null
                    when (result) {
                        is PaywallResult.Purchased -> {
                            if (result.customerInfo.entitlements.active[PREMIUM_ENTITLEMENT] != null ||
                                result.customerInfo.entitlements.active[BATTERY_CARE_ENTITLEMENT] != null
                            ) {
                                action?.invoke()
                            }
                        }
                        is PaywallResult.Restored -> {
                            if (result.customerInfo.entitlements.active[PREMIUM_ENTITLEMENT] != null ||
                                result.customerInfo.entitlements.active[BATTERY_CARE_ENTITLEMENT] != null
                            ) {
                                action?.invoke()
                            }
                        }
                        else -> Unit
                    }
                }
            },
        )

        setContent {
            val vm: DashboardViewModel = viewModel()
            LaunchedEffect(pendingDeepLinkPair) {
                val raw = pendingDeepLinkPair
                if (!raw.isNullOrBlank()) {
                    pendingDeepLinkPair = null
                    vm.handleQrPairInput(raw)
                }
            }
            SweeprTheme {
                SweeprRoot(
                    vm = vm,
                    onShowPaywall = { then ->
                        afterPurchase = then
                        paywallLauncher.launch(shouldDisplayDismissButton = true)
                    },
                    onPurchasePlan = { productId, then ->
                        launchPlanPurchase(productId, vm, then)
                    },
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        PlayAppUpdateManager.checkAndPrompt(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        extractDeepLinkPair(intent)
    }

    private fun extractDeepLinkPair(intent: Intent?) {
        val data = intent?.data ?: return
        val isCustomScheme = data.scheme == "sweeprcleaner" && data.host == "pair"
        val isHttpsAppLink = (data.scheme == "https" || data.scheme == "http") &&
            (data.host == "sweeprcleaner.com" || data.host == "www.sweeprcleaner.com") &&
            (data.path?.startsWith("/pair") == true)
        if (isCustomScheme || isHttpsAppLink) {
            val token = data.getQueryParameter("token") ?: data.getQueryParameter("challenge")
            pendingDeepLinkPair = token?.takeIf { it.isNotBlank() } ?: data.toString()
        }
    }

    private fun launchPlanPurchase(
        productId: String,
        vm: DashboardViewModel,
        then: () -> Unit,
    ) {
        val launchDirectPlayOrFallback = {
            PlayBillingManager.launchPurchase(
                activity = this@MainActivity,
                productId = productId,
                onSuccess = { purchasedId, pToken, orderId ->
                    vm.syncGooglePlayPurchase(
                        productId = purchasedId,
                        purchaseToken = pToken,
                        orderId = orderId,
                        isNewPurchase = true,
                    )
                    then()
                },
                onFallback = {
                    afterPurchase = then
                    paywallLauncher.launch(shouldDisplayDismissButton = true)
                },
            )
        }
        if (!Purchases.isConfigured || !BuildConfig.REVENUECAT_API_KEY.startsWith("goog_")) {
            launchDirectPlayOrFallback()
            return
        }
        Purchases.sharedInstance.getProducts(
            listOf(productId),
            object : GetStoreProductsCallback {
                override fun onReceived(storeProducts: List<StoreProduct>) {
                    val product = storeProducts.firstOrNull()
                    if (product == null) {
                        launchDirectPlayOrFallback()
                        return
                    }
                    Purchases.sharedInstance.purchase(
                        PurchaseParams.Builder(this@MainActivity, product).build(),
                        object : PurchaseCallback {
                            override fun onCompleted(storeTransaction: StoreTransaction, customerInfo: CustomerInfo) {
                                vm.applyCustomerInfo(customerInfo)
                                val pToken = storeTransaction.purchaseToken
                                if (pToken.isNotBlank()) {
                                    vm.syncGooglePlayPurchase(
                                        productId = productId,
                                        purchaseToken = pToken,
                                        orderId = storeTransaction.orderId,
                                        isNewPurchase = true,
                                    )
                                }
                                then()
                            }

                            override fun onError(error: PurchasesError, userCancelled: Boolean) {
                                if (!userCancelled) {
                                    vm.showMessage(error.message)
                                }
                            }
                        },
                    )
                }

                override fun onError(error: PurchasesError) {
                    launchDirectPlayOrFallback()
                }
            },
        )
    }
}

enum class Screen {
    // Bottom-navigation tabs
    Dashboard, Settings,

    // Detail screens
    PhotosVideos, Swipe, Screenshots, Contacts, Trash, CloudSavings, BatteryCare, Account, About, Tips,
    QuickCleanReview, CleaningComplete,
}

private val TABS = listOf(Screen.Dashboard, Screen.Swipe, Screen.BatteryCare, Screen.CloudSavings, Screen.Settings)
private val RESULT_SCREENS = setOf(Screen.PhotosVideos, Screen.Screenshots, Screen.Trash, Screen.QuickCleanReview)

data class PermissionState(
    val media: Boolean = false,
    val mediaLimited: Boolean = false,
    val contactsRead: Boolean = false,
    val contactsWrite: Boolean = false,
)

object AppPermissions {
    fun mediaPermissions(): Array<String> = when {
        Build.VERSION.SDK_INT >= 34 -> arrayOf(
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VIDEO,
            Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
        )
        Build.VERSION.SDK_INT >= 33 -> arrayOf(
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VIDEO,
        )
        Build.VERSION.SDK_INT >= 29 -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE)
    }

    fun contactsPermissions(): Array<String> = arrayOf(
        Manifest.permission.READ_CONTACTS,
        Manifest.permission.WRITE_CONTACTS,
    )

    /** Requests media and contacts permissions needed for scanning. Notification permission is requested contextually in Settings. */
    fun all(): Array<String> {
        return mediaPermissions() + contactsPermissions()
    }

    fun current(context: Context): PermissionState {
        fun granted(permission: String) =
            ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

        val full = if (Build.VERSION.SDK_INT >= 33) {
            granted(Manifest.permission.READ_MEDIA_IMAGES) || granted(Manifest.permission.READ_MEDIA_VIDEO)
        } else {
            granted(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        val limited = !full && Build.VERSION.SDK_INT >= 34 &&
            granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)

        return PermissionState(
            media = full || limited,
            mediaLimited = limited,
            contactsRead = granted(Manifest.permission.READ_CONTACTS),
            contactsWrite = granted(Manifest.permission.WRITE_CONTACTS),
        )
    }
}

@Composable
fun SweeprRoot(
    vm: DashboardViewModel = viewModel(),
    onShowPaywall: (then: () -> Unit) -> Unit = {},
    onPurchasePlan: (productId: String, then: () -> Unit) -> Unit = { _, then -> onShowPaywall(then) },
) {
    val context = LocalContext.current
    val state by vm.state.collectAsState()
    var screen by rememberSaveable { mutableStateOf(Screen.Dashboard) }
    var lastTab by rememberSaveable { mutableStateOf(Screen.Dashboard) }
    var photosInitialTab by rememberSaveable { mutableIntStateOf(0) }
    var permissions by remember { mutableStateOf(AppPermissions.current(context)) }
    var scanAfterGrant by remember { mutableStateOf(false) }
    var showMediaDisclosure by rememberSaveable { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        permissions = AppPermissions.current(context)
        if (scanAfterGrant) {
            scanAfterGrant = false
            if (permissions.media || permissions.contactsRead) {
                vm.scan(permissions)
            } else {
                vm.showMessage(context.getString(R.string.msg_need_permissions))
            }
        }
    }

    // Android's own "Allow Sweepr to move these items to trash?" or restore confirmation dialog.
    val trashLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { result ->
        vm.onTrashResult(result.resultCode == Activity.RESULT_OK)
    }

    val requestAccessAndScan: () -> Unit = {
        if (permissions.media) {
            vm.scan(permissions)
        } else {
            showMediaDisclosure = true
        }
    }
    val requestPermissions: () -> Unit = {
        scanAfterGrant = true
        permissionLauncher.launch(AppPermissions.contactsPermissions())
    }

    if (showMediaDisclosure) {
        AlertDialog(
            onDismissRequest = { showMediaDisclosure = false },
            title = { Text("Photos & Videos Access Disclosure") },
            text = {
                Text(
                    "SWEEPR Cleaner needs access to your device's Photos and Videos solely to scan for duplicate photos, similar bursts, large videos, and screenshots so you can review and free up storage space.\n\nAll photo and video analysis happens 100% locally on your device. Your media is never uploaded or shared with any server.",
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showMediaDisclosure = false
                        scanAfterGrant = true
                        permissionLauncher.launch(AppPermissions.mediaPermissions())
                    },
                ) {
                    Text(stringResource(R.string.action_continue))
                }
            },
            dismissButton = {
                TextButton(onClick = { showMediaDisclosure = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }

    // Re-check permissions and subscription entitlements when coming back to the app.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                permissions = AppPermissions.current(context)
                vm.refreshSubscriptionStatus()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Auto-run pre-scan on launch as soon as media or contacts permission is available
    // so all bento tiles show real MB/GB recoverable badges instead of dead "Tap to scan" states.
    LaunchedEffect(permissions.media, permissions.contactsRead) {
        if (!state.hasScanned && !state.isScanning && (permissions.media || permissions.contactsRead)) {
            vm.scan(permissions)
        }
    }

    LaunchedEffect(state.pendingTrash) {
        state.pendingTrash?.let { pending ->
            trashLauncher.launch(IntentSenderRequest.Builder(pending.intentSender).build())
        }
    }

    LaunchedEffect(state.message) {
        state.message?.let {
            vm.clearMessage()
            snackbarHostState.showSnackbar(it)
        }
    }

    LaunchedEffect(state.updateStatus.forceUpdate) {
        if (state.updateStatus.forceUpdate) {
            (context as? Activity)?.let { act ->
                PlayAppUpdateManager.checkAndPrompt(act, forceUpdate = true)
            }
        }
    }

    if (state.updateStatus.forceUpdate) {
        AlertDialog(
            onDismissRequest = {},
            properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
            title = { Text("Update Required") },
            text = {
                Text(
                    buildString {
                        append("A mandatory update (v${state.updateStatus.latestVersion}) is required to continue using SWEEPR Cleaner safely.")
                        if (state.updateStatus.notes.isNotBlank()) {
                            append("\n\n")
                            append(state.updateStatus.notes)
                        }
                    },
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        PlayAppUpdateManager.openPlayStore(
                            context = context,
                            marketUri = state.updateStatus.marketUri,
                            webUrl = state.updateStatus.playStoreUrl,
                        )
                    },
                ) {
                    Text("Update on Google Play")
                }
            },
        )
    }

    // #25 In-App Review prompt after the user's 2nd successful cleanup
    if (state.promptInAppReview) {
        AlertDialog(
            onDismissRequest = vm::clearReviewPrompt,
            title = { Text(stringResource(R.string.review_prompt_title)) },
            text = { Text(stringResource(R.string.review_prompt_body)) },
            confirmButton = {
                Button(
                    onClick = {
                        vm.clearReviewPrompt()
                        runCatching {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${context.packageName}"))
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        }.onFailure {
                            context.openUrl("https://play.google.com/store/apps/details?id=${context.packageName}")
                        }
                    },
                ) {
                    Text(stringResource(R.string.about_rate))
                }
            },
            dismissButton = {
                TextButton(onClick = vm::clearReviewPrompt) {
                    Text(stringResource(R.string.review_prompt_later))
                }
            },
        )
    }

    // Results screens need a scan first (e.g. after the process was restarted).
    val current = when {
        !state.hasScanned && screen in RESULT_SCREENS -> lastTab
        screen == Screen.CleaningComplete && state.lastCleanup == null -> lastTab
        else -> screen
    }
    val isTab = current in TABS

    // A media clean finished while the Quick Clean review was open → celebrate (mockup #10).
    LaunchedEffect(state.lastCleanup) {
        if (state.lastCleanup != null && screen == Screen.QuickCleanReview) screen = Screen.CleaningComplete
    }

    val selectTab: (Screen) -> Unit = { tab ->
        lastTab = tab
        screen = tab
    }
    val open: (Screen) -> Unit = { target ->
        if (target in TABS) selectTab(target) else screen = target
    }
    val openPhotosTab: (Int) -> Unit = { tab ->
        photosInitialTab = tab
        screen = Screen.PhotosVideos
    }
    val goBack: () -> Unit = {
        screen = when {
            current == Screen.Account || current == Screen.About -> Screen.Settings
            current in TABS -> Screen.Dashboard.also { lastTab = it }
            else -> lastTab
        }
    }

    var showPaywallSheet by remember { mutableStateOf(false) }
    var pendingPaywallAction by remember { mutableStateOf<(() -> Unit)?>(null) }

    val requestPaywall: (() -> Unit) -> Unit = { then ->
        pendingPaywallAction = then
        showPaywallSheet = true
    }

    // Premium gate: scanning is free, cleaning needs the subscription. If the user
    // subscribes from the paywall, the clean they asked for runs straight away.
    fun premium(action: () -> Unit) {
        if (state.hasPremium) action() else requestPaywall(action)
    }

    if (showPaywallSheet) {
        PaywallModalSheet(
            state = state,
            onDismiss = { showPaywallSheet = false },
            onContinueToGooglePlay = { productId ->
                val next = pendingPaywallAction ?: {}
                pendingPaywallAction = null
                onPurchasePlan(productId, next)
            },
            onRestore = vm::restorePurchases,
            onOpenEmailSignIn = {
                lastTab = Screen.Settings
                screen = Screen.Account
            },
        )
    }

    val handleTrash: (List<MediaItem>) -> Unit = { items -> premium { vm.requestTrash(items) } }
    val handleRestoreTrash: (List<MediaItem>) -> Unit = { items -> vm.requestRestoreFromTrash(items) }
    val handleCompressVideo: (MediaItem, CompressionPreset) -> Unit = { item, preset ->
        premium { vm.compressVideo(item, preset) }
    }
    val handleOptimizePhotos: (List<MediaItem>, Boolean, Boolean, PhotoCompressionPreset) -> Unit =
        { items, compressRes, stripGps, preset ->
            premium { vm.optimizePhotos(items, compressRes, stripGps, preset) }
        }
    val handleMerge: (Set<String>) -> Unit = { groups -> premium { vm.mergeContactGroups(groups) } }
    val handleDeleteIncompleteContacts: (Set<Long>) -> Unit = { ids -> premium { vm.deleteIncompleteContacts(ids) } }
    val handleDeleteCalendarEvents: (Set<Long>) -> Unit = { ids -> premium { vm.deleteCalendarEvents(ids) } }
    val handleCleanUp: () -> Unit = { premium { vm.cleanUpSelected(AppPermissions.current(context)) } }

    BackHandler(enabled = current != Screen.Dashboard) { goBack() }

    Scaffold(
        bottomBar = {
            if (isTab) SweeprBottomBar(current, selectTab)
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
            when (current) {
                Screen.Dashboard -> DashboardScreen(
                    state = state,
                    permissions = permissions,
                    onScan = requestAccessAndScan,
                    onManageLimitedMedia = {
                        scanAfterGrant = true
                        permissionLauncher.launch(AppPermissions.mediaPermissions())
                    },
                    onOpen = open,
                    onOpenPhotosTab = openPhotosTab,
                    onCleanUp = handleCleanUp,
                    onOpenReview = {
                        vm.clearCleanupSummary()
                        screen = Screen.QuickCleanReview
                    },
                    onUpgrade = { requestPaywall {} },
                )
                Screen.QuickCleanReview -> QuickCleanReviewScreen(
                    state = state,
                    onToggle = vm::toggleMedia,
                    onSetSelected = vm::setMediaSelected,
                    onSetContactGroupsSelected = vm::setContactGroupsSelected,
                    onOpenPhotosTab = openPhotosTab,
                    onOpen = open,
                    onCleanUp = handleCleanUp,
                    onBack = goBack,
                )
                Screen.CleaningComplete -> CleaningCompleteScreen(
                    summary = state.lastCleanup,
                    state = state,
                    onDone = {
                        vm.clearCleanupSummary()
                        selectTab(Screen.Dashboard)
                    },
                )
                Screen.Settings -> SettingsScreen(
                    state = state,
                    permissions = permissions,
                    onOpen = open,
                    onUpgrade = { requestPaywall {} },
                    onRestore = vm::restorePurchases,
                    onSendOtp = vm::sendOtp,
                    onVerifyOtp = vm::verifyOtp,
                    onSignOut = vm::signOutAccount,
                    onDeleteAccount = vm::deleteAccount,
                    onRedeemReferral = vm::redeemReferralCode,
                    onRescan = {
                        selectTab(Screen.Dashboard)
                        requestAccessAndScan()
                    },
                    onBack = goBack,
                )
                Screen.Account -> AccountScreen(
                    state = state,
                    onUpgrade = { productId -> onPurchasePlan(productId) {} },
                    onRestore = vm::restorePurchases,
                    onSendOtp = vm::sendOtp,
                    onVerifyOtp = vm::verifyOtp,
                    onQrPair = vm::handleQrPairInput,
                    onSubmitSupport = vm::submitSupportTicket,
                    onSignOut = vm::signOutAccount,
                    onDeleteAccount = vm::deleteAccount,
                    onBack = goBack,
                )
                Screen.About -> AboutScreen(onBack = goBack)
                Screen.Tips -> TipsScreen(onBack = goBack)
                Screen.CloudSavings -> CloudSavingsScreen(
                    state = state,
                    onOpenPhotosTab = openPhotosTab,
                    onOpen = open,
                    onShowPaywall = requestPaywall,
                    onOpenBattery = { open(Screen.BatteryCare) },
                    onBack = null,
                )
                Screen.BatteryCare -> BatteryCareScreen(
                    state = state,
                    onUnlockAddon = requestPaywall,
                    onOpenVault = { open(Screen.CloudSavings) },
                    onBack = null,
                )
                Screen.PhotosVideos -> PhotosVideosScreen(
                    state = state,
                    initialTab = photosInitialTab,
                    onToggle = vm::toggleMedia,
                    onSetSelected = vm::setMediaSelected,
                    onTrash = handleTrash,
                    onCompressVideo = handleCompressVideo,
                    onClearCompressionResult = vm::clearCompressionResult,
                    onOptimizePhotos = handleOptimizePhotos,
                    onClearPhotoOptimizationResult = vm::clearPhotoOptimizationResult,
                    onOpenScreenshots = { open(Screen.Screenshots) },
                    onBack = goBack,
                )
                Screen.Screenshots -> ScreenshotsScreen(
                    state = state,
                    onToggle = vm::toggleMedia,
                    onSetSelected = vm::setMediaSelected,
                    onTrash = handleTrash,
                    onBack = goBack,
                )
                Screen.Trash -> TrashScreen(
                    state = state,
                    onToggleTrash = vm::toggleTrash,
                    onSetTrashSelected = vm::setTrashSelected,
                    onRestore = handleRestoreTrash,
                    onBack = goBack,
                )
                Screen.Swipe -> SwipeCleanupScreen(
                    items = state.media.everything,
                    busy = state.isBusy,
                    onTrash = handleTrash,
                    onScan = requestAccessAndScan,
                    onBack = null,
                )
                Screen.Contacts -> ContactsScreen(
                    state = state,
                    permissions = permissions,
                    onToggle = vm::toggleContactGroup,
                    onMerge = handleMerge,
                    onRequestPermission = requestPermissions,
                    onToggleIncompleteContact = vm::toggleIncompleteContact,
                    onSetIncompleteContactsSelected = vm::setIncompleteContactsSelected,
                    onDeleteIncompleteContacts = handleDeleteIncompleteContacts,
                    onScanCalendarEvents = vm::scanCalendarEvents,
                    onToggleCalendarEvent = vm::toggleCalendarEvent,
                    onSetCalendarEventsSelected = vm::setCalendarEventsSelected,
                    onDeleteCalendarEvents = handleDeleteCalendarEvents,
                    onBack = goBack,
                )
            }

            // Sits above the sticky Clean Up Now / Move to trash buttons.
            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = 88.dp),
            )
        }
    }
}

private data class NavTab(val screen: Screen, val labelRes: Int, val iconKind: SweeprIconKind)

private val NAV_TABS = listOf(
    NavTab(Screen.Dashboard, R.string.nav_home, SweeprIconKind.SPARKLE_CLEAN),
    NavTab(Screen.Swipe, R.string.nav_swipe, SweeprIconKind.SWIPE_DECK),
    NavTab(Screen.BatteryCare, R.string.nav_battery_vault, SweeprIconKind.VAULT_SHIELD),
    NavTab(Screen.Settings, R.string.nav_settings, SweeprIconKind.CONTACTS),
)

@Composable
private fun SweeprBottomBar(current: Screen, onSelect: (Screen) -> Unit) {
    androidx.compose.foundation.layout.Column {
        androidx.compose.material3.HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        NavigationBar(
            containerColor = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
        ) {
            NAV_TABS.forEach { tab ->
                val isSelected = current == tab.screen ||
                    (tab.screen == Screen.BatteryCare && current == Screen.CloudSavings)
                val iconTint = if (isSelected) SweeprGreen else MaterialTheme.colorScheme.onSurfaceVariant
                NavigationBarItem(
                    selected = isSelected,
                    onClick = { onSelect(tab.screen) },
                    icon = {
                        SweeprVectorIcon(
                            kind = tab.iconKind,
                            tint = iconTint,
                            modifier = Modifier.padding(vertical = 1.dp),
                        )
                    },
                    label = {
                        Text(
                            text = stringResource(tab.labelRes),
                            fontSize = 11.sp,
                            fontWeight = if (isSelected) androidx.compose.ui.text.font.FontWeight.ExtraBold else androidx.compose.ui.text.font.FontWeight.Medium,
                            maxLines = 1,
                            softWrap = false,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            letterSpacing = (-0.2).sp,
                        )
                    },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = SweeprGreen,
                        selectedTextColor = emeraldText(),
                        indicatorColor = SweeprGreen.copy(alpha = 0.15f),
                        unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                )
            }
        }
    }
}
