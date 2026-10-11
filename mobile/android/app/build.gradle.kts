plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.sweepr.app"
    compileSdk = 34

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    defaultConfig {
        applicationId = "com.sweepr.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        // Only ship the languages Sweepr is translated into (drops unused library translations).
        resourceConfigurations += listOf("en", "es", "fr", "de", "it", "pt", "nl")
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.activity:activity-compose:1.8.2")
    // Per-app language (AppCompatDelegate.setApplicationLocales) on Android 8+
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")
    implementation(platform("androidx.compose:compose-bom:2024.04.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")

    // Weekly / monthly cleanup reminders
    implementation("androidx.work:work-runtime-ktx:2.9.0")

    // Image + video thumbnails for the cleanup grids and swipe cards
    implementation("io.coil-kt:coil-compose:2.6.0")
    implementation("io.coil-kt:coil-video:2.6.0")

    // RevenueCat
    implementation("com.revenuecat.purchases:purchases:8.2.1")
    implementation("com.revenuecat.purchases:purchases-ui:8.2.1") // Paywalls UI
}
