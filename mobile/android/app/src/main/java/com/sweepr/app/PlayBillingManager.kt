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
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var billingClient: BillingClient? = null
    private val productDetailsMap = ConcurrentHashMap<String, ProductDetails>()
    private var pendingCallback: ((productId: String, purchaseToken: String, orderId: String?) -> Unit)? = null

    private val _prices = MutableStateFlow(defaultLocalePrices())
    val prices: StateFlow<Map<String, PlayProductPrice>> = _prices.asStateFlow()

    private fun defaultLocalePrices(locale: Locale = Locale.getDefault()): Map<String, PlayProductPrice> {
        val currency = runCatching { Currency.getInstance(locale) }.getOrNull()
        val code = currency?.currencyCode ?: "GBP"
        val isUsd = code == "USD" || code == "CAD" || code == "AUD"
        val isEur = code == "EUR"

        fun fmt(gbpAmount: Double, usdAmount: Double, eurAmount: Double): String {
            val amount = when {
                isUsd -> usdAmount
                isEur -> eurAmount
                else -> gbpAmount
            }
            return runCatching {
                val nf = NumberFormat.getCurrencyInstance(locale)
                if (currency != null) nf.currency = currency
                nf.format(amount)
            }.getOrElse {
                when {
                    isUsd -> "$%.2f".format(Locale.US, usdAmount)
                    isEur -> "€%.2f".format(Locale.US, eurAmount)
                    else -> "£%.2f".format(Locale.UK, gbpAmount)
                }
            }
        }

        val monthlyIntro = fmt(1.99, 1.99, 1.99)
        val monthlyRenew = fmt(9.99, 9.99, 9.99)
        val sixMonth = fmt(38.99, 38.99, 38.99)
        val sixMonthPerMo = fmt(6.50, 6.50, 6.50)
        val annual = fmt(49.99, 49.99, 49.99)
        val annualPerMo = fmt(4.16, 4.16, 4.16)
        val batteryCare = fmt(9.99, 9.99, 9.99)

        return mapOf(
            "sweepr_monthly_999" to PlayProductPrice(
                productId = "sweepr_monthly_999",
                formattedPrice = monthlyIntro,
                subtitle = "1st mo, then $monthlyRenew",
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
                formattedPrice = batteryCare,
                subtitle = "$batteryCare/yr",
                currencyCode = code,
            ),
        )
    }

    fun init(context: Context) {
        _prices.value = defaultLocalePrices(Locale.getDefault())
        if (billingClient != null) return
        val appCtx = context.applicationContext
        val client = BillingClient.newBuilder(appCtx)
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build(),
            )
            .build()
        billingClient = client
        connectAndQuery(appCtx, client)
    }

    private fun connectAndQuery(appCtx: Context, client: BillingClient) {
        runCatching {
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                        queryStoreProducts(client)
                        queryActivePurchases(appCtx) { activePurchases ->
                            if (activePurchases.isNotEmpty()) {
                                scope.launch {
                                    for (purchase in activePurchases) {
                                        runCatching {
                                            val prodId = purchase.products.firstOrNull() ?: "sweepr_annual_4999"
                                            val current = Prefs.account.value
                                            val updated = SweeprAccountApi.verifyGooglePlayPurchase(
                                                productId = prodId,
                                                purchaseToken = purchase.purchaseToken,
                                                orderId = purchase.orderId,
                                                current = current,
                                            )
                                            Prefs.setLinkedAccount(updated)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                override fun onBillingServiceDisconnected() {
                    // Reconnected on next purchase attempt if needed
                }
            })
        }
    }

    fun queryActivePurchases(context: Context, onResult: (List<Purchase>) -> Unit) {
        val client = billingClient
        if (client == null || !client.isReady) {
            onResult(emptyList())
            return
        }
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
    }

    private fun queryStoreProducts(client: BillingClient) {
        val subsProducts = listOf(
            "sweepr_monthly_999",
            "sweepr_six_month_3899",
            "sweepr_annual_4999",
            "sweepr_battery_care_999",
        ).map { id ->
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(id)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        }
        val subsParams = QueryProductDetailsParams.newBuilder()
            .setProductList(subsProducts)
            .build()

        client.queryProductDetailsAsync(subsParams) { result, detailsList ->
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

        client.queryProductDetailsAsync(inappParams) { result, detailsList ->
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

    fun launchPurchase(
        activity: Activity,
        productId: String,
        onSuccess: (productId: String, purchaseToken: String, orderId: String?) -> Unit,
        onFallback: () -> Unit,
    ) {
        val client = billingClient
        val details = productDetailsMap[productId]
        if (client == null || !client.isReady || details == null) {
            onFallback()
            return
        }
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

    override fun onPurchasesUpdated(billingResult: BillingResult, purchases: MutableList<Purchase>?) {
        if (billingResult.responseCode != BillingClient.BillingResponseCode.OK || purchases.isNullOrEmpty()) {
            return
        }
        val client = billingClient
        for (purchase in purchases) {
            if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
                val prodId = purchase.products.firstOrNull() ?: "sweepr_annual_4999"
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
                        runCatching {
                            val current = Prefs.account.value
                            val updated = SweeprAccountApi.verifyGooglePlayPurchase(
                                productId = prodId,
                                purchaseToken = pToken,
                                orderId = orderId,
                                current = current,
                            )
                            Prefs.setLinkedAccount(updated)
                        }
                    }
                }
            }
        }
    }
}
