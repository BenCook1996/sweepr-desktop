plugins {
    id("com.android.application") version "8.2.0" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    // Kotlin 2.x ships the Compose compiler as a Gradle plugin. Using it fixes Android Studio's
    // "Composable function call without Compose plugin" errors.
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
