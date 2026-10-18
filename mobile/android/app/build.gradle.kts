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
    (findProperty("SWEEPR_API_URL") as String?)?.takeIf { it.isNotBlank() }
        ?: localProps.getProperty("SWEEPR_API_URL")?.takeIf { it.isNotBlank() }
        ?: sweeprWebsiteUrl

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

        buildConfigField("String", "REVENUECAT_API_KEY", "\"$revenueCatApiKey\"")
        buildConfigField("String", "SWEEPR_WEBSITE_URL", "\"$sweeprWebsiteUrl\"")
        buildConfigField("String", "SWEEPR_SUPPORT_EMAIL", "\"$sweeprSupportEmail\"")
        buildConfigField("String", "SWEEPR_API_URL", "\"$sweeprApiUrl\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

gradle.taskGraph.whenReady {
    val isReleaseBuild = allTasks.any { task ->
        task.project == project && task.name.contains("Release", ignoreCase = true)
    }
    if (isReleaseBuild && !revenueCatApiKey.startsWith("goog_")) {
        throw GradleException(
            "Release builds must configure a production RevenueCat Google Play API key (goog_...) " +
                "via REVENUECAT_API_KEY in local.properties or -PREVENUECAT_API_KEY. Found: '$revenueCatApiKey'"
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
}
