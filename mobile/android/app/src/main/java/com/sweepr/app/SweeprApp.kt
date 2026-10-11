package com.sweepr.app

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.decode.VideoFrameDecoder
import com.revenuecat.purchases.LogLevel
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration

class SweeprApp : Application(), ImageLoaderFactory {
    override fun onCreate() {
        super.onCreate()

        Prefs.init(this)
        Reminders.createChannel(this)
        Reminders.schedule(this, Prefs.reminder.value, replace = false)
        
        // Enable debug logs for testing, remove in production
        Purchases.logLevel = LogLevel.DEBUG
        
        // Initialize RevenueCat SDK
        Purchases.configure(
            PurchasesConfiguration.Builder(this, "test_ivOfZALfmxHMtyKQZXOxmKqYibQ")
                .build()
        )
    }

    /** Coil image loader that can also render a frame from video files as a thumbnail. */
    override fun newImageLoader(): ImageLoader =
        ImageLoader.Builder(this)
            .components { add(VideoFrameDecoder.Factory()) }
            .crossfade(true)
            .build()
}
