package com.sweepr.app

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

data class PlayProductPrice(
    val productId: String,
    val formattedPrice: String,
    val subtitle: String,
    val currencyCode: String,
)

/**
 * Direct Google Play Billing Library (`BillingClient`) integration that:
 * 1. Queries localized `ProductDetails` for subscriptions (`sweepr_monthly_999`, `sweepr_six_month_3899`,
 *    `sweepr_annual_4999`) and in-app / add-on items (`sweepr_battery_care_999`), falling back to
 *    device-locale `Currency.getInstance(Locale.getDefault())` formatted prices when Google Play is offline.
 * 2. Launches native Google Play billing sheets (`launchBillingFlow`) even when RevenueCat is using a
 *    fallback/test key, acknowledges completed purchases (`acknowledgePurchase`), and verifies them via
 *    `POST /v1/billing/google-play/verify`.
 */
object PlayBillingManager : PurchasesUpdatedListener {
    private const val SKU_MONTHLY = "sweepr_monthly_999"
    private const val SKU_SIX_MONTH = "sweepr_six_month_3899"
    private const val SKU_ANNUAL = "sweepr_annual_4999"
    private const val SKU_BATTERY_CARE = "sweepr_battery_care_999"
    private const val SKU_CLOUD_VAULT = "sweepr_cloud_vault_999"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile
    private var billingClient: BillingClient? = null
    @Volatile
    private var isConnecting: Boolean = false
    private val connectionWaiters = java.util.concurrent.CopyOnWriteArrayList<Pair<(BillingClient) -> Unit, () -> Unit>>()
    private val productDetailsMap = ConcurrentHashMap<String, ProductDetails>()
    private var pendingCallback: ((productId: String, purchaseToken: String, orderId: String?) -> Unit)? = null

    private val _prices = MutableStateFlow(defaultLocalePrices())
    val prices: StateFlow<Map<String, PlayProductPrice>> = _prices.asStateFlow()

    private fun defaultLocalePrices(locale: Locale = Locale.getDefault()): Map<String, PlayProductPrice> {
        val currency = runCatching { Currency.getInstance(locale) }.getOrNull()
        val code = currency?.currencyCode ?: "GBP"

        data class TierAmounts(
            val intro: Double,
            val monthly: Double,
            val sixMo: Double,
            val sixEq: Double,
            val annual: Double,
            val annualEq: Double,
            val addon: Double,
        )

        val amounts = when (code) {
            "USD" -> TierAmounts(1.99, 12.99, 49.99, 8.33, 64.99, 5.42, 9.99)
            "EUR" -> TierAmounts(1.99, 11.99, 44.99, 7.50, 59.99, 5.00, 9.99)
            "CAD" -> TierAmounts(2.99, 16.99, 64.99, 10.83, 89.99, 7.50, 9.99)
            "AUD" -> TierAmounts(2.99, 18.99, 74.99, 12.50, 99.99, 8.33, 9.99)
            "NZD" -> TierAmounts(2.99, 19.99, 79.99, 13.33, 109.99, 9.17, 9.99)
            "CHF" -> TierAmounts(1.99, 11.99, 44.99, 7.50, 59.99, 5.00, 9.99)
            "SEK", "NOK" -> TierAmounts(25.0, 129.0, 499.0, 83.0, 649.0, 54.0, 99.0)
            "DKK" -> TierAmounts(15.0, 89.0, 349.0, 58.0, 449.0, 37.0, 69.0)
            "PLN" -> TierAmounts(9.99, 49.99, 189.99, 31.67, 249.99, 20.83, 39.99)
            "JPY" -> TierAmounts(300.0, 1980.0, 7400.0, 1233.0, 9800.0, 817.0, 1500.0)
            "INR" -> TierAmounts(199.0, 599.0, 2199.0, 367.0, 2999.0, 250.0, 799.0)
            "SGD" -> TierAmounts(2.99, 16.99, 64.99, 10.83, 84.99, 7.08, 9.99)
            "BRL" -> TierAmounts(9.90, 49.90, 189.90, 31.65, 249.90, 20.83, 49.90)
            else -> TierAmounts(1.99, 9.99, 38.99, 6.50, 49.99, 4.16, 9.99)
        }

        fun fmt(amount: Double): String = runCatching {
            val nf = NumberFormat.getCurrencyInstance(locale)
            if (currency != null) nf.currency = currency
            nf.format(amount)
        }.getOrElse { "£%.2f".format(Locale.UK, amount) }

        val monthlyIntro = fmt(amounts.intro)
        val monthlyRenew = fmt(amounts.monthly)
        val sixMonth = fmt(amounts.sixMo)
        val sixMonthPerMo = fmt(amounts.sixEq)
        val annual = fmt(amounts.annual)
        val annualPerMo = fmt(amounts.annualEq)
        val addonFormatted = fmt(amounts.addon)

        return mapOf(
            "sweepr_monthly_999" to PlayProductPrice(
                productId = "sweepr_monthly_999",
                formattedPrice = monthlyRenew,
                subtitle = "Billed monthly · Cancel anytime",
                currencyCode = code,
            ),
            "sweepr_six_month_3899" to PlayProductPrice(
                productId = "sweepr_six_month_3899",
                formattedPrice = sixMonth,
                subtitle = "Save 35% ($sixMonthPerMo/mo)",
                currencyCode = code,
            ),
            "sweepr_annual_4999" to PlayProductPrice(
                productId = "sweepr_annual_4999",
                formattedPrice = annual,
                subtitle = "Save 58% ($annualPerMo/mo)",
                currencyCode = code,
            ),
            "sweepr_battery_care_999" to PlayProductPrice(
                productId = "sweepr_battery_care_999",
                formattedPrice = addonFormatted,
                subtitle = "$addonFormatted/yr",
                currencyCode = code,
            ),
            "sweepr_cloud_vault_999" to PlayProductPrice(
                productId = "sweepr_cloud_vault_999",
                formattedPrice = addonFormatted,
                subtitle = "$addonFormatted/yr",
                currencyCode = code,
            ),
        )
    }

    fun init(context: Context) {
        _prices.value = defaultLocalePrices(Locale.getDefault())
        val appCtx = context.applicationContext
        queryActivePurchases(appCtx) { activePurchases ->
            if (activePurchases.isNotEmpty()) {
                scope.launch {
                    for (purchase in activePurchases) {
                        val prodId = purchase.products.firstOrNull() ?: SKU_ANNUAL
                        syncPurchaseToAccount(prodId, purchase.purchaseToken, purchase.orderId)
                    }
                }
            }
        }
    }

    private fun syncPurchaseToAccount(prodId: String, purchaseToken: String, orderId: String?) {
        val current = Prefs.account.value
        val isBatteryAddon = prodId.equals(SKU_BATTERY_CARE, ignoreCase = true) ||
            prodId.contains("battery_care", ignoreCase = true)
        val isCloudAddon = prodId.equals(SKU_CLOUD_VAULT, ignoreCase = true) ||
            prodId.contains("cloud_vault", ignoreCase = true)
        val isAddonOnly = isBatteryAddon || isCloudAddon
        val nextAddons = buildList {
            addAll(current.addons)
            if (isBatteryAddon && !contains("battery_care")) add("battery_care")
            if (isCloudAddon && !contains("cloud_vault")) add("cloud_vault")
        }
        val localFallback = current.copy(
            serverActive = if (isAddonOnly) current.serverActive else true,
            plan = if (isAddonOnly) (current.plan ?: "addon_only") else (current.plan ?: prodId),
            expiresAt = if (current.expiresAt > 0L) current.expiresAt else (System.currentTimeMillis() / 1000L + 365L * 86400L),
            addons = nextAddons,
        )
        val updated = runCatching {
            SweeprAccountApi.verifyGooglePlayPurchase(
                productId = prodId,
                purchaseToken = purchaseToken,
                orderId = orderId,
                current = current,
            )
        }.getOrDefault(localFallback)
        Prefs.setLinkedAccount(updated)
    }

    fun ensureConnected(
        context: Context,
        onReady: (BillingClient) -> Unit,
        onError: () -> Unit = {},
    ) {
        val existing = billingClient
        if (existing != null && existing.isReady) {
            onReady(existing)
            return
        }
        connectionWaiters.add(onReady to onError)
        if (isConnecting) return
        isConnecting = true

        val appCtx = context.applicationContext
        val client = existing ?: BillingClient.newBuilder(appCtx)
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build(),
            )
            .build()
            .also { billingClient = it }

        runCatching {
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    isConnecting = false
                    val waiters = ArrayList(connectionWaiters)
                    connectionWaiters.clear()
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                        queryStoreProducts(client)
                        waiters.forEach { (ready, _) -> ready(client) }
                    } else {
                        waiters.forEach { (_, err) -> err() }
                    }
                }

                override fun onBillingServiceDisconnected() {
                    val waiters = synchronized(connectionWaiters) {
                        isConnecting = false
                        connectionWaiters.toList().also { connectionWaiters.clear() }
                    }
                    waiters.forEach { (_, err) -> err() }
                }
            })
        }.onFailure {
            isConnecting = false
            val waiters = ArrayList(connectionWaiters)
            connectionWaiters.clear()
            waiters.forEach { (_, err) -> err() }
        }
    }

    fun queryActivePurchases(context: Context, onResult: (List<Purchase>) -> Unit) {
        ensureConnected(
            context = context,
            onReady = { client ->
                val subsParams = QueryPurchasesParams.newBuilder()
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
                val inappParams = QueryPurchasesParams.newBuilder()
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()

                client.queryPurchasesAsync(subsParams) { subsResult, subsPurchases ->
                    val activeSubs = if (subsResult.responseCode == BillingClient.BillingResponseCode.OK) {
                        subsPurchases.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }
                    } else {
                        emptyList()
                    }
                    for (p in activeSubs) {
                        if (!p.isAcknowledged) {
                            val ackParams = AcknowledgePurchaseParams.newBuilder()
                                .setPurchaseToken(p.purchaseToken)
                                .build()
                            client.acknowledgePurchase(ackParams) {}
                        }
                    }
                    client.queryPurchasesAsync(inappParams) { inappResult, inappPurchases ->
                        val activeInapp = if (inappResult.responseCode == BillingClient.BillingResponseCode.OK) {
                            inappPurchases.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }
                        } else {
                            emptyList()
                        }
                        for (p in activeInapp) {
                            if (!p.isAcknowledged) {
                                val ackParams = AcknowledgePurchaseParams.newBuilder()
                                    .setPurchaseToken(p.purchaseToken)
                                    .build()
                                client.acknowledgePurchase(ackParams) {}
                            }
                        }
                        val combined = (activeSubs + activeInapp).distinctBy { it.purchaseToken }
                        onResult(combined)
                    }
                }
            },
            onError = { onResult(emptyList()) },
        )
    }

    private fun queryStoreProducts(client: BillingClient) {
        val subsProducts = listOf(
            "sweepr_monthly_999",
            "sweepr_six_month_3899",
            "sweepr_annual_4999",
            "sweepr_battery_care_999",
            "sweepr_cloud_vault_999",
        ).map { id ->
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(id)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        }
        val subsParams = QueryProductDetailsParams.newBuilder()
            .setProductList(subsProducts)
            .build()

        client.queryProductDetailsAsync(subsParams) { result, subsDetailsResult ->
            val detailsList = subsDetailsResult.productDetailsList
            if (result.responseCode == BillingClient.BillingResponseCode.OK && detailsList.isNotEmpty()) {
                val updated = _prices.value.toMutableMap()
                for (details in detailsList) {
                    productDetailsMap[details.productId] = details
                    val phases = details.subscriptionOfferDetails
                        ?.firstOrNull()
                        ?.pricingPhases
                        ?.pricingPhaseList
                        .orEmpty()
                    val firstPhase = phases.firstOrNull()
                    val recurringPhase = phases.lastOrNull()
                    if (firstPhase != null) {
                        val existing = updated[details.productId]
                        val subText = if (phases.size > 1 && recurringPhase != null) {
                            "1st mo, then ${recurringPhase.formattedPrice}"
                        } else {
                            existing?.subtitle ?: firstPhase.formattedPrice
                        }
                        updated[details.productId] = PlayProductPrice(
                            productId = details.productId,
                            formattedPrice = firstPhase.formattedPrice,
                            subtitle = subText,
                            currencyCode = firstPhase.priceCurrencyCode,
                        )
                    }
                }
                _prices.value = updated
            }
        }

        val inappProducts = listOf(
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId("sweepr_battery_care_999")
                .setProductType(BillingClient.ProductType.INAPP)
                .build(),
        )
        val inappParams = QueryProductDetailsParams.newBuilder()
            .setProductList(inappProducts)
            .build()

        client.queryProductDetailsAsync(inappParams) { result, inappDetailsResult ->
            val detailsList = inappDetailsResult.productDetailsList
            if (result.responseCode == BillingClient.BillingResponseCode.OK && detailsList.isNotEmpty()) {
                val updated = _prices.value.toMutableMap()
                for (details in detailsList) {
                    if (!productDetailsMap.containsKey(details.productId)) {
                        productDetailsMap[details.productId] = details
                    }
                    val oneTime = details.oneTimePurchaseOfferDetails
                    if (oneTime != null && details.subscriptionOfferDetails == null) {
                        updated[details.productId] = PlayProductPrice(
                            productId = details.productId,
                            formattedPrice = oneTime.formattedPrice,
                            subtitle = "${oneTime.formattedPrice}/yr",
                            currencyCode = oneTime.priceCurrencyCode,
                        )
                    }
                }
                _prices.value = updated
            }
        }
    }

    private fun launchBillingFlowWithDetails(
        activity: Activity,
        client: BillingClient,
        details: ProductDetails,
        onSuccess: (productId: String, purchaseToken: String, orderId: String?) -> Unit,
        onFallback: () -> Unit,
    ) {
        activity.runOnUiThread {
            val offerToken = details.subscriptionOfferDetails?.firstOrNull()?.offerToken
            val productDetailsParamsBuilder = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(details)
            if (details.productType == BillingClient.ProductType.SUBS && !offerToken.isNullOrBlank()) {
                productDetailsParamsBuilder.setOfferToken(offerToken)
            }
            val flowParams = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(listOf(productDetailsParamsBuilder.build()))
                .build()
            pendingCallback = onSuccess
            val billingResult = client.launchBillingFlow(activity, flowParams)
            if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
                pendingCallback = null
                onFallback()
            }
        }
    }

    fun launchPurchase(
        activity: Activity,
        productId: String,
        onSuccess: (productId: String, purchaseToken: String, orderId: String?) -> Unit,
        onFallback: () -> Unit,
    ) {
        ensureConnected(
            context = activity,
            onReady = { client ->
                val cached = productDetailsMap[productId]
                if (cached != null) {
                    launchBillingFlowWithDetails(activity, client, cached, onSuccess, onFallback)
                    return@ensureConnected
                }
                val subsParam = QueryProductDetailsParams.newBuilder()
                    .setProductList(
                        listOf(
                            QueryProductDetailsParams.Product.newBuilder()
                                .setProductId(productId)
                                .setProductType(BillingClient.ProductType.SUBS)
                                .build(),
                        ),
                    )
                    .build()
                client.queryProductDetailsAsync(subsParam) { subsResult, subsDetailsResult ->
                    val subsList = subsDetailsResult.productDetailsList
                    val foundSub = subsList.firstOrNull()
                    if (subsResult.responseCode == BillingClient.BillingResponseCode.OK && foundSub != null) {
                        productDetailsMap[productId] = foundSub
                        launchBillingFlowWithDetails(activity, client, foundSub, onSuccess, onFallback)
                        return@queryProductDetailsAsync
                    }
                    if (productId == SKU_BATTERY_CARE) {
                        val inappParam = QueryProductDetailsParams.newBuilder()
                            .setProductList(
                                listOf(
                                    QueryProductDetailsParams.Product.newBuilder()
                                        .setProductId(productId)
                                        .setProductType(BillingClient.ProductType.INAPP)
                                        .build(),
                                ),
                            )
                            .build()
                        client.queryProductDetailsAsync(inappParam) { inappResult, inappDetailsResult ->
                            val inappList = inappDetailsResult.productDetailsList
                            val foundInapp = inappList.firstOrNull()
                            if (inappResult.responseCode == BillingClient.BillingResponseCode.OK && foundInapp != null) {
                                productDetailsMap[productId] = foundInapp
                                launchBillingFlowWithDetails(activity, client, foundInapp, onSuccess, onFallback)
                            } else {
                                activity.runOnUiThread { onFallback() }
                            }
                        }
                    } else {
                        activity.runOnUiThread { onFallback() }
                    }
                }
            },
            onError = { activity.runOnUiThread { onFallback() } },
        )
    }

    override fun onPurchasesUpdated(billingResult: BillingResult, purchases: MutableList<Purchase>?) {
        if (billingResult.responseCode != BillingClient.BillingResponseCode.OK || purchases.isNullOrEmpty()) {
            if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
                pendingCallback = null
            }
            return
        }
        val client = billingClient
        for (purchase in purchases) {
            if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
                val prodId = purchase.products.firstOrNull() ?: SKU_ANNUAL
                val pToken = purchase.purchaseToken
                val orderId = purchase.orderId
                if (!purchase.isAcknowledged && client != null) {
                    val ackParams = AcknowledgePurchaseParams.newBuilder()
                        .setPurchaseToken(pToken)
                        .build()
                    client.acknowledgePurchase(ackParams) {}
                }
                val cb = pendingCallback
                pendingCallback = null
                if (cb != null) {
                    cb(prodId, pToken, orderId)
                } else {
                    scope.launch {
                        syncPurchaseToAccount(prodId, pToken, orderId)
                    }
                }
            }
        }
    }
}
