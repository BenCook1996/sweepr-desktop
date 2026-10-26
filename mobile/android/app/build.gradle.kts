import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// RevenueCat public SDK key: read from the REVENUECAT_API_KEY gradle property (-P / ~/.gradle/gradle.properties)
// or from local.properties (not committed). Falls back to the Test Store key so local builds keep working.
// IMPORTANT: release builds shipped to Google Play MUST use the production "goog_..." key.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val revenueCatApiKey: String =
    (findProperty("REVENUECAT_API_KEY") as String?)?.takeIf { it.isNotBlank() }
        ?: localProps.getProperty("REVENUECAT_API_KEY")?.takeIf { it.isNotBlank() }
        ?: "test_ivOfZALfmxHMtyKQZXOxmKqYibQ"

val sweeprWebsiteUrl: String =
    (findProperty("SWEEPR_WEBSITE_URL") as String?)?.takeIf { it.isNotBlank() }
        ?: localProps.getProperty("SWEEPR_WEBSITE_URL")?.takeIf { it.isNotBlank() }
        ?: "https://sweeprcleaner.com"

val sweeprSupportEmail: String =
    (findProperty("SWEEPR_SUPPORT_EMAIL") as String?)?.takeIf { it.isNotBlank() }
        ?: localProps.getProperty("SWEEPR_SUPPORT_EMAIL")?.takeIf { it.isNotBlank() }
        ?: "support@sweeprcleaner.com"

val sweeprApiUrl: String =
    (findProperty("SWEEPR_CRM_URL") as String?)?.takeIf { it.isNotBlank() }
        ?: localProps.getProperty("SWEEPR_CRM_URL")?.takeIf { it.isNotBlank() }
        ?: (findProperty("SWEEPR_API_URL") as String?)?.takeIf { it.isNotBlank() }
        ?: localProps.getProperty("SWEEPR_API_URL")?.takeIf { it.isNotBlank() }
        ?: sweeprWebsiteUrl

val sweeprLicensePubkey: String =
    (findProperty("SWEEPR_LICENSE_PUBKEY") as String?)?.takeIf { it.isNotBlank() }
        ?: localProps.getProperty("SWEEPR_LICENSE_PUBKEY")?.takeIf { it.isNotBlank() }
        ?: "t04hn-7TfW5RIemEhi4mKbZy6rHRYBO6HxeN5OOIR_8"

android {
    namespace = "com.sweepr.app"
    compileSdk = 35

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
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        // Only ship the languages Sweepr is translated into (drops unused library translations).
        resourceConfigurations += listOf("en", "es", "fr", "de", "it", "pt", "nl")

        buildConfigField("String", "REVENUECAT_API_KEY", "\"$revenueCatApiKey\"")
        buildConfigField("String", "SWEEPR_WEBSITE_URL", "\"$sweeprWebsiteUrl\"")
        buildConfigField("String", "SWEEPR_SUPPORT_EMAIL", "\"$sweeprSupportEmail\"")
        buildConfigField("String", "SWEEPR_API_URL", "\"$sweeprApiUrl\"")
        buildConfigField("String", "SWEEPR_PROJECT_ID", "\"cleaner\"")
        buildConfigField("String", "SWEEPR_LICENSE_PUBKEY", "\"$sweeprLicensePubkey\"")
    }

    signingConfigs {
        create("release") {
            val ksFile = file("upload-keystore.jks")
            if (ksFile.exists()) {
                storeFile = ksFile
                storePassword = (findProperty("SWEEPR_KEYSTORE_PASSWORD") as String?)
                    ?: localProps.getProperty("SWEEPR_KEYSTORE_PASSWORD")
                    ?: "SweeprCleaner2026!"
                keyAlias = (findProperty("SWEEPR_KEY_ALIAS") as String?)
                    ?: localProps.getProperty("SWEEPR_KEY_ALIAS")
                    ?: "sweeprcleaner"
                keyPassword = (findProperty("SWEEPR_KEY_PASSWORD") as String?)
                    ?: localProps.getProperty("SWEEPR_KEY_PASSWORD")
                    ?: "SweeprCleaner2026!"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        warning += setOf("MissingTranslation", "ExtraTranslation")
    }
}

gradle.taskGraph.whenReady {
    val isReleaseBuild = allTasks.any { task ->
        task.project == project && task.name.contains("Release", ignoreCase = true)
    }
    if (isReleaseBuild && !revenueCatApiKey.startsWith("goog_")) {
        logger.lifecycle(
            "NOTE: Building release with fallback RevenueCat key ('$revenueCatApiKey'). " +
                "Direct SweeprAccountApi (/v1/billing/google-play/verify) & Cross-Platform OTP/QR entitlement verification remain active."
        )
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

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20231013")
    testImplementation("org.mockito:mockito-core:5.11.0")
}
