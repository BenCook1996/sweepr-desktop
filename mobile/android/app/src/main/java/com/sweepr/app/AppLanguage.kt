package com.sweepr.app

import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import androidx.annotation.StringRes
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat

/** A choice in Settings → Language. [tag] is empty for "System default". */
enum class AppLanguage(val tag: String, @StringRes val labelRes: Int) {
    System("", R.string.option_system_default),
    English("en", R.string.lang_en),
    Spanish("es", R.string.lang_es),
    French("fr", R.string.lang_fr),
    German("de", R.string.lang_de),
    Italian("it", R.string.lang_it),
    Portuguese("pt", R.string.lang_pt),
    Dutch("nl", R.string.lang_nl);

    companion object {
        /** The language currently chosen in the app (System if the user never picked one). */
        fun current(): AppLanguage {
            val locales = AppCompatDelegate.getApplicationLocales()
            if (locales.isEmpty) return System
            val language = locales[0]?.language ?: return System
            return entries.firstOrNull { it != System && it.tag == language } ?: System
        }

        /** Applies the language app-wide; AppCompat recreates the activity and persists the choice. */
        fun apply(language: AppLanguage) {
            AppCompatDelegate.setApplicationLocales(
                if (language == System) LocaleListCompat.getEmptyLocaleList()
                else LocaleListCompat.forLanguageTags(language.tag),
            )
        }
    }
}

/**
 * A context whose resources follow the in-app language. On Android 13+ the system already
 * applies it to every context; on older versions AppCompat only localizes activities, so
 * non-UI code (ViewModel messages, notifications, scanners) uses this.
 */
fun Context.localized(): Context {
    if (Build.VERSION.SDK_INT >= 33) return this
    val locales = AppCompatDelegate.getApplicationLocales()
    if (locales.isEmpty) return this
    val config = Configuration(resources.configuration)
    config.setLocales(LocaleList.forLanguageTags(locales.toLanguageTags()))
    return createConfigurationContext(config)
}
