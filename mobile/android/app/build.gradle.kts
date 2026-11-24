import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// RevenueCat public SDK key:
// - Debug builds read RC_TEST_STORE_KEY (or REVENUECAT_API_KEY) so Test Store QA works locally.
// - Release builds ONLY accept a production Google Play key starting with "goog_"; never bundle "test_..." into release.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val rcTestStoreKey: String =
    (findProperty("RC_TEST_STORE_KEY") as String?)?.takeIf { it.isNotBlank() }
        ?: localProps.getProperty("RC_TEST_STORE_KEY")?.takeIf { it.isNotBlank() }
        ?: System.getenv("RC_TEST_STORE_KEY")?.takeIf { it.isNotBlank() }
        ?: ""
val revenueCatAnyKey: String =
    (findProperty("REVENUECAT_API_KEY") as String?)?.takeIf { it.isNotBlank() }
        ?: localProps.getProperty("REVENUECAT_API_KEY")?.takeIf { it.isNotBlank() }
        ?: System.getenv("REVENUECAT_API_KEY")?.takeIf { it.isNotBlank() }
        ?: ""
val revenueCatProdKey: String = revenueCatAnyKey.takeIf { it.startsWith("goog_") } ?: ""
val revenueCatDebugKey: String = rcTestStoreKey.ifBlank { revenueCatAnyKey }

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

fun escapeBuildConfigString(value: String): String =
    value.replace("\\", "\\\\").replace("\"", "\\\"")

android {
    namespace = "com.sweepr.app"
    compileSdk = 36

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
        targetSdk = 36
        versionCode = 6
        versionName = "1.0.5"

        // Only ship the languages Sweepr is translated into (drops unused library translations).
        resourceConfigurations += listOf("en", "es", "fr", "de", "it", "pt", "nl")

        buildConfigField("String", "SWEEPR_WEBSITE_URL", "\"${escapeBuildConfigString(sweeprWebsiteUrl)}\"")
        buildConfigField("String", "SWEEPR_PUBLIC_URL", "\"${escapeBuildConfigString(sweeprWebsiteUrl)}\"")
        buildConfigField("String", "SWEEPR_SUPPORT_EMAIL", "\"${escapeBuildConfigString(sweeprSupportEmail)}\"")
        buildConfigField("String", "SWEEPR_API_URL", "\"${escapeBuildConfigString(sweeprApiUrl)}\"")
        buildConfigField("String", "SWEEPR_PROJECT_ID", "\"cleaner\"")
        buildConfigField("String", "SWEEPR_LICENSE_PUBKEY", "\"${escapeBuildConfigString(sweeprLicensePubkey)}\"")
        buildConfigField("String", "SWEEPR_ED25519_PUBKEY_B64", "\"${escapeBuildConfigString(sweeprLicensePubkey)}\"")
    }

    bundle {
        language {
            // Keep all 7 app languages in the base APK split so in-app AppCompatDelegate language switching works on Play AAB installs.
            enableSplit = false
        }
    }

    signingConfigs {
        create("release") {
            val ksFile = file("upload-keystore.jks")
            val ksPassword = (findProperty("SWEEPR_KEYSTORE_PASSWORD") as String?)
                ?: localProps.getProperty("SWEEPR_KEYSTORE_PASSWORD")
                ?: System.getenv("SWEEPR_KEYSTORE_PASSWORD")
                ?: ""
            if (ksFile.exists() && ksPassword.isNotBlank()) {
                storeFile = ksFile
                storePassword = ksPassword
                keyAlias = (findProperty("SWEEPR_KEY_ALIAS") as String?)
                    ?: localProps.getProperty("SWEEPR_KEY_ALIAS")
                    ?: System.getenv("SWEEPR_KEY_ALIAS")
                    ?: "sweeprcleaner"
                keyPassword = (findProperty("SWEEPR_KEY_PASSWORD") as String?)
                    ?: localProps.getProperty("SWEEPR_KEY_PASSWORD")
                    ?: System.getenv("SWEEPR_KEY_PASSWORD")
                    ?: ksPassword
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "REVENUECAT_API_KEY", "\"${escapeBuildConfigString(revenueCatDebugKey)}\"")
        }
        release {
            buildConfigField("String", "REVENUECAT_API_KEY", "\"${escapeBuildConfigString(revenueCatProdKey)}\"")
            isMinifyEnabled = true
            isShrinkResources = true
            val relSigning = signingConfigs.getByName("release")
            val hasValidReleaseKeystore = relSigning.storeFile?.exists() == true && !relSigning.storePassword.isNullOrBlank()
            if (hasValidReleaseKeystore) {
                signingConfig = relSigning
            }
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
    if (isReleaseBuild) {
        val relSigning = android.signingConfigs.getByName("release")
        val hasValidReleaseKeystore = relSigning.storeFile?.exists() == true && !relSigning.storePassword.isNullOrBlank()
        if (!hasValidReleaseKeystore) {
            throw GradleException("Release build requires upload-keystore.jks and SWEEPR_KEYSTORE_PASSWORD (never fall back to debug signing).")
        }
        if (!revenueCatProdKey.startsWith("goog_")) {
            logger.lifecycle(
                "NOTE: Building release without a production goog_ RevenueCat key. " +
                    "Direct PlayBillingManager + SweeprAccountApi (/v1/billing/google-play/verify) & Cross-Platform OTP/QR remain active; " +
                    "supply -PREVENUECAT_API_KEY=goog_... before Play Production launch."
            )
        }
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

    // RevenueCat + Direct Google Play Billing Library + Google Play In-App Updates + BouncyCastle Ed25519 (API 26+)
    implementation("com.revenuecat.purchases:purchases:8.10.0")
    implementation("com.revenuecat.purchases:purchases-ui:8.10.0") // Paywalls UI
    implementation("com.android.billingclient:billing-ktx:7.1.1")
    implementation("com.google.android.play:app-update-ktx:2.1.0")
    implementation("com.google.android.play:review-ktx:2.0.1")
    implementation("org.bouncycastle:bcprov-jdk15to18:1.70")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20231013")
    testImplementation("org.mockito:mockito-core:5.11.0")
}
